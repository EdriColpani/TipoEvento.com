-- Fase 6: repasse gestor (settlement ledger), retenção D+N, estorno e clawback

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'system_billing_settings'
  ) THEN
    ALTER TABLE public.system_billing_settings
      ADD COLUMN IF NOT EXISTS credit_settlement_retention_days INTEGER NOT NULL DEFAULT 7;
    COMMENT ON COLUMN public.system_billing_settings.credit_settlement_retention_days IS
      'Dias de retenção antes de liberar repasse ao gestor (consumo crédito EventFest).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.credit_payout_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  manager_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
  settlement_count INTEGER NOT NULL DEFAULT 0 CHECK (settlement_count >= 0),
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  mp_payout_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.manager_credit_settlement_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  spend_order_id UUID NOT NULL REFERENCES public.credit_spend_orders(id) ON DELETE RESTRICT,
  split_id UUID NOT NULL REFERENCES public.credit_financial_splits(id) ON DELETE RESTRICT,
  manager_amount NUMERIC(12, 2) NOT NULL CHECK (manager_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'released', 'paid', 'clawback', 'cancelled')),
  release_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payout_batch_id UUID REFERENCES public.credit_payout_batches(id) ON DELETE SET NULL,
  mp_payout_reference TEXT,
  clawback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT manager_credit_settlement_split_unique UNIQUE (split_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_credit_settlement_company_status
  ON public.manager_credit_settlement_ledger(company_id, status, release_at);

CREATE TABLE IF NOT EXISTS public.credit_refund_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  refund_amount NUMERIC(12, 2) NOT NULL CHECK (refund_amount > 0),
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'rejected', 'mp_pending')),
  reason TEXT NOT NULL,
  public_description TEXT,
  ledger_entry_id UUID REFERENCES public.credit_ledger_entries(id) ON DELETE SET NULL,
  clawback_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.get_credit_settlement_retention_days()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    0,
    COALESCE(
      (SELECT s.credit_settlement_retention_days FROM public.system_billing_settings s WHERE s.id = 1),
      7
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.credit_settlement_from_split()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention INTEGER;
BEGIN
  IF NEW.manager_amount IS NULL OR NEW.manager_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_retention := public.get_credit_settlement_retention_days();

  INSERT INTO public.manager_credit_settlement_ledger (
    company_id,
    spend_order_id,
    split_id,
    manager_amount,
    status,
    release_at
  ) VALUES (
    NEW.receiver_company_id,
    NEW.spend_order_id,
    NEW.id,
    NEW.manager_amount,
    'pending',
    timezone('utc'::text, now()) + make_interval(days => v_retention)
  )
  ON CONFLICT (split_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_settlement_from_split ON public.credit_financial_splits;
CREATE TRIGGER trg_credit_settlement_from_split
  AFTER INSERT ON public.credit_financial_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_settlement_from_split();

INSERT INTO public.manager_credit_settlement_ledger (
  company_id,
  spend_order_id,
  split_id,
  manager_amount,
  status,
  release_at,
  created_at
)
SELECT
  s.receiver_company_id,
  s.spend_order_id,
  s.id,
  s.manager_amount,
  CASE
    WHEN timezone('utc'::text, now()) >= o.created_at + make_interval(days => public.get_credit_settlement_retention_days())
    THEN 'released'
    ELSE 'pending'
  END,
  o.created_at + make_interval(days => public.get_credit_settlement_retention_days()),
  o.created_at
FROM public.credit_financial_splits s
INNER JOIN public.credit_spend_orders o ON o.id = s.spend_order_id
WHERE s.manager_amount > 0
  AND o.status = 'completed'
ON CONFLICT (split_id) DO NOTHING;

UPDATE public.manager_credit_settlement_ledger
SET
  status = 'released',
  released_at = timezone('utc'::text, now()),
  updated_at = timezone('utc'::text, now())
WHERE status = 'pending'
  AND release_at <= timezone('utc'::text, now());

CREATE OR REPLACE FUNCTION public.process_credit_settlement_releases()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.manager_credit_settlement_ledger
  SET
    status = 'released',
    released_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE status = 'pending'
    AND release_at <= timezone('utc'::text, now());

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'released_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manager_credit_settlements(
  p_company_id UUID,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_summary JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.release_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.id,
      m.company_id,
      m.spend_order_id,
      m.manager_amount,
      m.status,
      m.release_at,
      m.released_at,
      m.paid_at,
      m.payout_batch_id,
      m.mp_payout_reference,
      o.public_description AS spend_description,
      o.created_at AS spend_at
    FROM public.manager_credit_settlement_ledger m
    INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
    WHERE m.company_id = p_company_id
      AND (p_status IS NULL OR m.status = p_status)
    ORDER BY m.release_at ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  SELECT jsonb_build_object(
    'pending', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'released', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0),
    'paid', COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN status = 'clawback' THEN manager_amount ELSE 0 END), 0)
  )
  INTO v_summary
  FROM public.manager_credit_settlement_ledger
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'items', v_rows,
    'summary', v_summary,
    'retention_days', public.get_credit_settlement_retention_days()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_manager_credit_payout(
  p_company_id UUID,
  p_settlement_ids UUID[] DEFAULT NULL,
  p_actor_user_id UUID DEFAULT auth.uid(),
  p_mp_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_total NUMERIC(12, 2);
  v_count INTEGER;
  v_ref TEXT;
BEGIN
  IF p_company_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id, p_actor_user_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();

  IF p_settlement_ids IS NOT NULL AND COALESCE(array_length(p_settlement_ids, 1), 0) > 0 THEN
    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_total, v_count
    FROM public.manager_credit_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released'
      AND id = ANY (p_settlement_ids);
  ELSE
    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_total, v_count
    FROM public.manager_credit_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released';
  END IF;

  IF v_count = 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Nenhum repasse liberado disponível para pagamento.';
  END IF;

  v_ref := COALESCE(NULLIF(trim(p_mp_reference), ''), 'EF-PAYOUT-' || gen_random_uuid()::text);

  INSERT INTO public.credit_payout_batches (
    company_id,
    manager_user_id,
    total_amount,
    settlement_count,
    status,
    mp_payout_reference,
    paid_at
  ) VALUES (
    p_company_id,
    p_actor_user_id,
    round(v_total, 2),
    v_count,
    'paid',
    v_ref,
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_batch_id;

  UPDATE public.manager_credit_settlement_ledger m
  SET
    status = 'paid',
    paid_at = timezone('utc'::text, now()),
    payout_batch_id = v_batch_id,
    mp_payout_reference = v_ref,
    updated_at = timezone('utc'::text, now())
  WHERE m.company_id = p_company_id
    AND m.status = 'released'
    AND (
      p_settlement_ids IS NULL
      OR COALESCE(array_length(p_settlement_ids, 1), 0) = 0
      OR m.id = ANY (p_settlement_ids)
    );

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'total_amount', round(v_total, 2),
    'settlement_count', v_count,
    'mp_payout_reference', v_ref
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_settlements(
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.id,
      m.company_id,
      c.corporate_name AS company_name,
      m.manager_amount,
      m.status,
      m.release_at,
      m.released_at,
      m.paid_at,
      m.mp_payout_reference,
      m.clawback_reason
    FROM public.manager_credit_settlement_ledger m
    LEFT JOIN public.companies c ON c.id = m.company_id
    ORDER BY m.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_refund_to_wallet(
  p_client_user_id UUID,
  p_amount NUMERIC DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.client_credit_accounts%ROWTYPE;
  v_amount NUMERIC(12, 2);
  v_new_balance NUMERIC(12, 2);
  v_desc TEXT;
  v_ledger_id UUID;
  v_refund_id UUID;
  v_clawback INTEGER;
  v_idem TEXT;
  v_reason TEXT;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'Cliente inválido.';
  END IF;

  v_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Estorno administrativo EventFest.');

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_refund_id
    FROM public.credit_refund_cases
    WHERE idempotency_key = trim(p_idempotency_key);
    IF v_refund_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'refund_case_id', v_refund_id);
    END IF;
  END IF;

  PERFORM public.ensure_client_credit_account(p_client_user_id);

  SELECT * INTO v_account
  FROM public.client_credit_accounts
  WHERE user_id = p_client_user_id
  FOR UPDATE;

  v_amount := round(COALESCE(p_amount, v_account.balance_cached), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Valor de estorno inválido.';
  END IF;
  IF v_amount > round(v_account.balance_cached, 2) THEN
    RAISE EXCEPTION 'Valor de estorno maior que o saldo disponível.';
  END IF;

  v_new_balance := round(v_account.balance_cached - v_amount, 2);
  v_desc := format(
    E'**Estorno de crédito EventFest** — R$ %s debitados da sua carteira.\nMotivo: %s\nSaldo após operação: R$ %s.',
    to_char(v_amount, 'FM999999990.00'),
    v_reason,
    to_char(v_new_balance, 'FM999999990.00')
  );

  v_idem := COALESCE(NULLIF(trim(p_idempotency_key), ''), 'refund:' || gen_random_uuid()::text);

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    reference_type,
    reference_id,
    public_description,
    internal_description,
    metadata
  ) VALUES (
    p_client_user_id,
    'refund',
    'refund_debit',
    -v_amount,
    v_new_balance,
    v_idem,
    'credit_refund_case',
    NULL,
    v_desc,
    format('Admin refund by %s', auth.uid()),
    jsonb_build_object('reason', v_reason, 'requested_by', auth.uid())
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.client_credit_accounts
  SET
    balance_cached = v_new_balance,
    version = version + 1,
    updated_at = timezone('utc'::text, now())
  WHERE user_id = p_client_user_id;

  UPDATE public.platform_credit_liability
  SET
    outstanding_amount = greatest(0, outstanding_amount - v_amount),
    updated_at = timezone('utc'::text, now())
  WHERE id = 1;

  UPDATE public.manager_credit_settlement_ledger m
  SET
    status = 'clawback',
    clawback_reason = v_reason,
    updated_at = timezone('utc'::text, now())
  FROM public.credit_spend_orders o
  WHERE m.spend_order_id = o.id
    AND o.client_user_id = p_client_user_id
    AND m.status IN ('pending', 'released');

  GET DIAGNOSTICS v_clawback = ROW_COUNT;

  INSERT INTO public.credit_refund_cases (
    client_user_id,
    requested_by,
    refund_amount,
    status,
    reason,
    public_description,
    ledger_entry_id,
    clawback_count,
    idempotency_key,
    completed_at
  ) VALUES (
    p_client_user_id,
    auth.uid(),
    v_amount,
    'completed',
    v_reason,
    v_desc,
    v_ledger_id,
    v_clawback,
    NULLIF(trim(p_idempotency_key), ''),
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_refund_id;

  UPDATE public.credit_ledger_entries
  SET reference_id = v_refund_id
  WHERE id = v_ledger_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_case_id', v_refund_id,
    'refund_amount', v_amount,
    'balance', v_new_balance,
    'clawback_settlements', v_clawback,
    'public_description', v_desc
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_refund_cases(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id,
      r.client_user_id,
      r.refund_amount,
      r.status,
      r.reason,
      r.public_description,
      r.clawback_count,
      r.created_at,
      r.completed_at
    FROM public.credit_refund_cases r
    ORDER BY r.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 200))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

ALTER TABLE public.manager_credit_settlement_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_refund_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manager_credit_settlement_select ON public.manager_credit_settlement_ledger;
CREATE POLICY manager_credit_settlement_select
  ON public.manager_credit_settlement_ledger FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = manager_credit_settlement_ledger.company_id
        AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS credit_payout_batches_select ON public.credit_payout_batches;
CREATE POLICY credit_payout_batches_select
  ON public.credit_payout_batches FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR manager_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = credit_payout_batches.company_id
        AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS credit_refund_cases_admin ON public.credit_refund_cases;
CREATE POLICY credit_refund_cases_admin
  ON public.credit_refund_cases FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

GRANT SELECT ON public.manager_credit_settlement_ledger TO authenticated;
GRANT SELECT ON public.credit_payout_batches TO authenticated;
GRANT SELECT ON public.credit_refund_cases TO authenticated;

GRANT EXECUTE ON FUNCTION public.process_credit_settlement_releases() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_manager_credit_settlements(UUID, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_manager_credit_payout(UUID, UUID[], UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_credit_settlements(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_refund_to_wallet(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_credit_refund_cases(INTEGER, INTEGER) TO authenticated;
