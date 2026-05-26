-- Fase 6.1: repasse MP imediato no spend (pool EventFest → gestor/parceiro receptor)

UPDATE public.system_billing_settings
SET credit_settlement_retention_days = 0
WHERE id = 1;

ALTER TABLE public.manager_credit_settlement_ledger
  DROP CONSTRAINT IF EXISTS manager_credit_settlement_ledger_status_check;

ALTER TABLE public.manager_credit_settlement_ledger
  ADD CONSTRAINT manager_credit_settlement_ledger_status_check
  CHECK (status IN (
    'pending', 'pending_mp', 'released', 'paid', 'disbursed',
    'disbursement_failed', 'clawback', 'cancelled'
  ));

CREATE TABLE IF NOT EXISTS public.credit_mp_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spend_order_id UUID NOT NULL UNIQUE REFERENCES public.credit_spend_orders(id) ON DELETE RESTRICT,
  split_id UUID NOT NULL UNIQUE REFERENCES public.credit_financial_splits(id) ON DELETE RESTRICT,
  receiver_company_id UUID NOT NULL,
  manager_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  mp_collector_id TEXT,
  gross_amount NUMERIC(12, 2) NOT NULL CHECK (gross_amount > 0),
  platform_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (platform_amount >= 0),
  manager_amount NUMERIC(12, 2) NOT NULL CHECK (manager_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'reversed')),
  mp_transfer_id TEXT,
  mp_external_reference TEXT NOT NULL,
  mp_mode TEXT,
  mp_error TEXT,
  idempotency_key TEXT UNIQUE,
  disbursed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_credit_mp_disbursements_company_status
  ON public.credit_mp_disbursements(receiver_company_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_receiver_company_mp_credentials(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager UUID;
  v_collector TEXT;
  v_company_name TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Empresa inválida.');
  END IF;

  SELECT c.corporate_name INTO v_company_name
  FROM public.companies c
  WHERE c.id = p_company_id;

  SELECT uc.user_id, ps.mp_collector_id
  INTO v_manager, v_collector
  FROM public.user_companies uc
  INNER JOIN public.payment_settings ps ON ps.user_id = uc.user_id
  WHERE uc.company_id = p_company_id
    AND ps.mp_collector_id IS NOT NULL
    AND trim(ps.mp_collector_id) <> ''
    AND ps.api_token_ciphertext IS NOT NULL
  ORDER BY uc.created_at ASC NULLS LAST
  LIMIT 1;

  IF v_manager IS NULL OR v_collector IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', format(
        'A empresa "%s" precisa conectar Mercado Pago (Perfil da Empresa → Ingressos MP) antes de receber crédito EventFest.',
        COALESCE(v_company_name, 'receptora')
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'manager_user_id', v_manager,
    'mp_collector_id', v_collector,
    'company_name', v_company_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_disbursement_from_split()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager UUID;
  v_collector TEXT;
BEGIN
  IF NEW.manager_amount IS NULL OR NEW.manager_amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT uc.user_id, ps.mp_collector_id
  INTO v_manager, v_collector
  FROM public.user_companies uc
  LEFT JOIN public.payment_settings ps ON ps.user_id = uc.user_id
  WHERE uc.company_id = NEW.receiver_company_id
  ORDER BY uc.created_at ASC NULLS LAST
  LIMIT 1;

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
    'pending_mp',
    timezone('utc'::text, now())
  )
  ON CONFLICT (split_id) DO NOTHING;

  INSERT INTO public.credit_mp_disbursements (
    spend_order_id,
    split_id,
    receiver_company_id,
    manager_user_id,
    mp_collector_id,
    gross_amount,
    platform_amount,
    manager_amount,
    status,
    mp_external_reference,
    idempotency_key
  ) VALUES (
    NEW.spend_order_id,
    NEW.id,
    NEW.receiver_company_id,
    v_manager,
    v_collector,
    NEW.gross_amount,
    NEW.platform_amount,
    NEW.manager_amount,
    'pending',
    'credit_disburse:' || NEW.spend_order_id::text,
    'disburse:' || NEW.spend_order_id::text
  )
  ON CONFLICT (spend_order_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_settlement_from_split ON public.credit_financial_splits;
CREATE TRIGGER trg_credit_disbursement_from_split
  AFTER INSERT ON public.credit_financial_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_disbursement_from_split();

CREATE OR REPLACE FUNCTION public.get_credit_spend_disbursement_status(p_spend_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.credit_mp_disbursements%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.credit_mp_disbursements
  WHERE spend_order_id = p_spend_order_id;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'status', v_row.status,
    'mp_transfer_id', v_row.mp_transfer_id,
    'mp_external_reference', v_row.mp_external_reference,
    'receiver_company_id', v_row.receiver_company_id,
    'manager_amount', v_row.manager_amount,
    'platform_amount', v_row.platform_amount,
    'mp_error', v_row.mp_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_credit_mp_disbursement(
  p_spend_order_id UUID,
  p_mp_transfer_id TEXT,
  p_mp_external_reference TEXT,
  p_mp_mode TEXT DEFAULT 'advanced_payments'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.credit_spend_orders%ROWTYPE;
  v_disb public.credit_mp_disbursements%ROWTYPE;
  v_split public.credit_financial_splits%ROWTYPE;
  v_company_name TEXT;
  v_event_title TEXT;
BEGIN
  IF p_spend_order_id IS NULL OR NULLIF(trim(p_mp_transfer_id), '') IS NULL THEN
    RAISE EXCEPTION 'Parâmetros de confirmação MP inválidos.';
  END IF;

  SELECT * INTO v_order FROM public.credit_spend_orders WHERE id = p_spend_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de consumo não encontrado.';
  END IF;

  SELECT * INTO v_disb FROM public.credit_mp_disbursements WHERE spend_order_id = p_spend_order_id FOR UPDATE;
  IF v_disb.id IS NULL THEN
    RAISE EXCEPTION 'Registro de repasse MP não encontrado.';
  END IF;

  IF v_disb.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'mp_transfer_id', v_disb.mp_transfer_id);
  END IF;

  SELECT * INTO v_split FROM public.credit_financial_splits WHERE id = v_disb.split_id;

  UPDATE public.credit_mp_disbursements
  SET
    status = 'completed',
    mp_transfer_id = trim(p_mp_transfer_id),
    mp_external_reference = COALESCE(NULLIF(trim(p_mp_external_reference), ''), mp_external_reference),
    mp_mode = NULLIF(trim(p_mp_mode), ''),
    mp_error = NULL,
    disbursed_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = v_disb.id;

  UPDATE public.manager_credit_settlement_ledger
  SET
    status = 'disbursed',
    released_at = COALESCE(released_at, timezone('utc'::text, now())),
    paid_at = timezone('utc'::text, now()),
    mp_payout_reference = trim(p_mp_transfer_id),
    updated_at = timezone('utc'::text, now())
  WHERE split_id = v_disb.split_id;

  SELECT c.corporate_name INTO v_company_name FROM public.companies c WHERE c.id = v_order.receiver_company_id;
  IF v_order.receiver_event_id IS NOT NULL THEN
    SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_order.receiver_event_id;
  END IF;

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    correlation_id,
    receiver_company_id,
    receiver_event_id,
    receiver_establishment_id,
    reference_type,
    reference_id,
    public_description,
    internal_description,
    metadata
  ) VALUES (
    v_order.client_user_id,
    'spend',
    'spend_commission_platform',
    0,
    (SELECT balance_cached FROM public.client_credit_accounts WHERE user_id = v_order.client_user_id),
    'spend:commission:' || p_spend_order_id::text,
    v_order.correlation_id,
    v_order.receiver_company_id,
    v_order.receiver_event_id,
    v_order.receiver_establishment_id,
    'credit_spend_order',
    p_spend_order_id,
    format(
      E'**Comissão EventFest (informativo)** — R$ %s retidos na operação da plataforma sobre consumo de R$ %s (%s%%).',
      to_char(v_split.platform_amount, 'FM999999990.00'),
      to_char(v_split.gross_amount, 'FM999999990.00'),
      to_char(v_split.applied_percentage, 'FM990.00')
    ),
    format('Platform commission | spend %s | MP %s', p_spend_order_id, trim(p_mp_transfer_id)),
    jsonb_build_object(
      'platform_amount', v_split.platform_amount,
      'gross_amount', v_split.gross_amount,
      'mp_transfer_id', trim(p_mp_transfer_id),
      'informational_only', true
    )
  );

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    correlation_id,
    receiver_company_id,
    receiver_event_id,
    receiver_establishment_id,
    reference_type,
    reference_id,
    public_description,
    internal_description,
    metadata
  ) VALUES (
    v_order.client_user_id,
    'spend',
    'spend_allocation_manager',
    0,
    (SELECT balance_cached FROM public.client_credit_accounts WHERE user_id = v_order.client_user_id),
    'spend:manager:' || p_spend_order_id::text,
    v_order.correlation_id,
    v_order.receiver_company_id,
    v_order.receiver_event_id,
    v_order.receiver_establishment_id,
    'credit_spend_order',
    p_spend_order_id,
    format(
      E'**Repasse automático Mercado Pago** — R$ %s transferidos para %s%s. Ref. MP: %s.',
      to_char(v_split.manager_amount, 'FM999999990.00'),
      COALESCE(v_company_name, 'empresa parceira'),
      CASE WHEN v_event_title IS NOT NULL THEN format(' — "%s"', v_event_title) ELSE '' END,
      trim(p_mp_transfer_id)
    ),
    format('Manager disbursement | spend %s | MP %s', p_spend_order_id, trim(p_mp_transfer_id)),
    jsonb_build_object(
      'manager_amount', v_split.manager_amount,
      'mp_transfer_id', trim(p_mp_transfer_id),
      'mp_external_reference', COALESCE(NULLIF(trim(p_mp_external_reference), ''), v_disb.mp_external_reference),
      'informational_only', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'mp_transfer_id', trim(p_mp_transfer_id),
    'manager_amount', v_split.manager_amount,
    'platform_amount', v_split.platform_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_credit_disbursement_failed(
  p_spend_order_id UUID,
  p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.credit_mp_disbursements
  SET
    status = 'failed',
    mp_error = left(COALESCE(p_error, 'Falha no repasse MP.'), 2000),
    updated_at = timezone('utc'::text, now())
  WHERE spend_order_id = p_spend_order_id;

  UPDATE public.manager_credit_settlement_ledger m
  SET
    status = 'disbursement_failed',
    clawback_reason = left(COALESCE(p_error, 'Falha MP.'), 500),
    updated_at = timezone('utc'::text, now())
  FROM public.credit_financial_splits s
  WHERE s.spend_order_id = p_spend_order_id
    AND m.split_id = s.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_credit_spend(
  p_spend_order_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.credit_spend_orders%ROWTYPE;
  v_account public.client_credit_accounts%ROWTYPE;
  v_new_balance NUMERIC(12, 2);
  v_analytics UUID[];
  v_meta JSONB;
BEGIN
  IF p_spend_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido inválido.';
  END IF;

  SELECT * INTO v_order
  FROM public.credit_spend_orders
  WHERE id = p_spend_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_order.status = 'reversed' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  SELECT metadata INTO v_meta
  FROM public.credit_ledger_entries
  WHERE reference_type = 'credit_spend_order'
    AND reference_id = p_spend_order_id
    AND entry_subtype = 'spend_debit'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_meta IS NOT NULL AND v_meta ? 'wristband_analytics_ids' THEN
    SELECT array_agg(value::uuid)
    INTO v_analytics
    FROM jsonb_array_elements_text(v_meta->'wristband_analytics_ids') AS value;
  END IF;

  IF v_analytics IS NOT NULL AND array_length(v_analytics, 1) > 0 THEN
    UPDATE public.wristband_analytics wa
    SET
      client_user_id = NULL,
      event_data = COALESCE(wa.event_data, '{}'::jsonb) - 'credit_spend_order_id' - 'payment_method'
    WHERE wa.id = ANY (v_analytics)
      AND wa.client_user_id = v_order.client_user_id;
  END IF;

  PERFORM public.ensure_client_credit_account(v_order.client_user_id);

  SELECT * INTO v_account
  FROM public.client_credit_accounts
  WHERE user_id = v_order.client_user_id
  FOR UPDATE;

  v_new_balance := round(v_account.balance_cached + v_order.gross_amount, 2);

  UPDATE public.client_credit_accounts
  SET
    balance_cached = v_new_balance,
    version = version + 1,
    updated_at = timezone('utc'::text, now())
  WHERE user_id = v_order.client_user_id;

  UPDATE public.platform_credit_liability
  SET
    outstanding_amount = outstanding_amount + v_order.gross_amount,
    updated_at = timezone('utc'::text, now())
  WHERE id = 1;

  UPDATE public.credit_spend_orders
  SET status = 'reversed'
  WHERE id = p_spend_order_id;

  UPDATE public.credit_mp_disbursements
  SET
    status = 'reversed',
    mp_error = left(COALESCE(p_reason, 'Estornado por falha no repasse.'), 2000),
    updated_at = timezone('utc'::text, now())
  WHERE spend_order_id = p_spend_order_id;

  UPDATE public.manager_credit_settlement_ledger m
  SET
    status = 'cancelled',
    clawback_reason = left(COALESCE(p_reason, 'Rollback spend.'), 500),
    updated_at = timezone('utc'::text, now())
  FROM public.credit_financial_splits s
  WHERE s.spend_order_id = p_spend_order_id
    AND m.split_id = s.id;

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    correlation_id,
    receiver_company_id,
    reference_type,
    reference_id,
    public_description,
    internal_description
  ) VALUES (
    v_order.client_user_id,
    'adjustment',
    'spend_rollback',
    v_order.gross_amount,
    v_new_balance,
    'rollback:' || p_spend_order_id::text,
    v_order.correlation_id,
    v_order.receiver_company_id,
    'credit_spend_order',
    p_spend_order_id,
    format(
      E'**Estorno automático** — R$ %s devolvidos à sua carteira (falha no repasse ao parceiro).',
      to_char(v_order.gross_amount, 'FM999999990.00')
    ),
    left(COALESCE(p_reason, 'rollback'), 500)
  );

  RETURN jsonb_build_object('ok', true, 'balance', v_new_balance);
END;
$$;

-- Backfill disbursements para splits existentes sem repasse MP
INSERT INTO public.credit_mp_disbursements (
  spend_order_id,
  split_id,
  receiver_company_id,
  gross_amount,
  platform_amount,
  manager_amount,
  status,
  mp_external_reference,
  idempotency_key
)
SELECT
  s.spend_order_id,
  s.id,
  s.receiver_company_id,
  s.gross_amount,
  s.platform_amount,
  s.manager_amount,
  CASE
    WHEN m.status IN ('paid', 'disbursed') AND m.mp_payout_reference IS NOT NULL THEN 'completed'
    WHEN m.status = 'disbursement_failed' THEN 'failed'
    ELSE 'pending'
  END,
  COALESCE(m.mp_payout_reference, 'credit_disburse:' || s.spend_order_id::text),
  'disburse:' || s.spend_order_id::text
FROM public.credit_financial_splits s
LEFT JOIN public.manager_credit_settlement_ledger m ON m.split_id = s.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.credit_mp_disbursements d WHERE d.spend_order_id = s.spend_order_id
)
ON CONFLICT (spend_order_id) DO NOTHING;

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
    RAISE EXCEPTION 'Informe a empresa.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      d.id,
      d.receiver_company_id AS company_id,
      d.spend_order_id,
      d.manager_amount,
      CASE d.status
        WHEN 'completed' THEN 'disbursed'
        WHEN 'pending' THEN 'pending_mp'
        WHEN 'processing' THEN 'pending_mp'
        WHEN 'failed' THEN 'disbursement_failed'
        ELSE d.status
      END AS status,
      d.created_at AS release_at,
      d.disbursed_at AS released_at,
      d.disbursed_at AS paid_at,
      NULL::uuid AS payout_batch_id,
      COALESCE(d.mp_transfer_id, d.mp_external_reference) AS mp_payout_reference,
      o.public_description AS spend_description,
      o.created_at AS spend_at,
      d.platform_amount,
      d.gross_amount,
      d.mp_transfer_id,
      d.mp_error
    FROM public.credit_mp_disbursements d
    INNER JOIN public.credit_spend_orders o ON o.id = d.spend_order_id
    WHERE d.receiver_company_id = p_company_id
      AND (p_status IS NULL OR p_status = '' OR
        CASE d.status
          WHEN 'completed' THEN 'disbursed'
          WHEN 'pending' THEN 'pending_mp'
          WHEN 'processing' THEN 'pending_mp'
          WHEN 'failed' THEN 'disbursement_failed'
          ELSE d.status
        END = p_status)
    ORDER BY d.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  SELECT jsonb_build_object(
    'pending', COALESCE(SUM(CASE WHEN d.status IN ('pending', 'processing') THEN d.manager_amount ELSE 0 END), 0),
    'released', 0,
    'paid', COALESCE(SUM(CASE WHEN d.status = 'completed' THEN d.manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN d.status = 'reversed' THEN d.manager_amount ELSE 0 END), 0),
    'failed', COALESCE(SUM(CASE WHEN d.status = 'failed' THEN d.manager_amount ELSE 0 END), 0)
  )
  INTO v_summary
  FROM public.credit_mp_disbursements d
  WHERE d.receiver_company_id = p_company_id;

  RETURN jsonb_build_object(
    'items', v_rows,
    'summary', v_summary,
    'retention_days', 0,
    'instant_disbursement', true
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

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      d.id,
      d.receiver_company_id AS company_id,
      c.corporate_name AS company_name,
      d.manager_amount,
      d.platform_amount,
      d.gross_amount,
      CASE d.status
        WHEN 'completed' THEN 'disbursed'
        WHEN 'pending' THEN 'pending_mp'
        WHEN 'processing' THEN 'pending_mp'
        WHEN 'failed' THEN 'disbursement_failed'
        ELSE d.status
      END AS status,
      d.created_at AS release_at,
      d.disbursed_at AS released_at,
      d.disbursed_at AS paid_at,
      d.mp_transfer_id AS mp_payout_reference,
      d.mp_error AS clawback_reason
    FROM public.credit_mp_disbursements d
    LEFT JOIN public.companies c ON c.id = d.receiver_company_id
    ORDER BY d.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_failed_credit_disbursements(
  p_company_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
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
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      d.id,
      d.spend_order_id,
      d.receiver_company_id,
      d.manager_amount,
      d.platform_amount,
      d.gross_amount,
      d.mp_error,
      o.status AS spend_status
    FROM public.credit_mp_disbursements d
    INNER JOIN public.credit_spend_orders o ON o.id = d.spend_order_id
    WHERE d.status = 'failed'
      AND o.status = 'completed'
      AND (p_company_id IS NULL OR d.receiver_company_id = p_company_id)
    ORDER BY d.updated_at ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 20), 100))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

-- Clawback estorno: incluir pending_mp e disbursed
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
    AND m.status IN ('pending', 'pending_mp', 'released', 'disbursed', 'disbursement_failed');

  UPDATE public.credit_mp_disbursements d
  SET
    status = 'reversed',
    mp_error = left('Clawback estorno: ' || v_reason, 2000),
    updated_at = timezone('utc'::text, now())
  FROM public.credit_spend_orders o
  WHERE d.spend_order_id = o.id
    AND o.client_user_id = p_client_user_id
    AND d.status IN ('pending', 'processing', 'failed', 'completed');

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

ALTER TABLE public.credit_mp_disbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_mp_disbursements_select ON public.credit_mp_disbursements;
CREATE POLICY credit_mp_disbursements_select
  ON public.credit_mp_disbursements FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = credit_mp_disbursements.receiver_company_id
        AND uc.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.credit_spend_orders o
      WHERE o.id = credit_mp_disbursements.spend_order_id
        AND o.client_user_id = auth.uid()
    )
  );

GRANT SELECT ON public.credit_mp_disbursements TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_receiver_company_mp_credentials(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_credit_spend_disbursement_status(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_credit_mp_disbursement(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_credit_disbursement_failed(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_credit_spend(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_failed_credit_disbursements(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_manages_credit_company(UUID, UUID) TO authenticated;
