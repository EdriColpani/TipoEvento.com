-- Chargeback/refund de compra de ingresso (Mercado Pago)
-- Caminho feliz de venda permanece intacto.
-- Em chargeback: cancela ingressos, audita, cria dívida abatível nos repasses D+1.

-- ---------------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ticket_chargeback_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id UUID NOT NULL REFERENCES public.receivables(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  client_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  mp_payment_id TEXT NOT NULL,
  mp_status TEXT NOT NULL,
  gross_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  platform_fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  manager_net_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tickets_cancelled_count INTEGER NOT NULL DEFAULT 0,
  already_checked_in BOOLEAN NOT NULL DEFAULT false,
  needs_manual_review BOOLEAN NOT NULL DEFAULT false,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  manager_notified_at TIMESTAMPTZ,
  manager_notify_resend_id TEXT,
  manager_notify_error TEXT,
  admin_notified_at TIMESTAMPTZ,
  admin_notify_resend_id TEXT,
  admin_notify_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ticket_chargeback_mp_payment_unique UNIQUE (mp_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_chargeback_cases_created
  ON public.ticket_chargeback_cases(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_chargeback_cases_company
  ON public.ticket_chargeback_cases(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_chargeback_cases_event
  ON public.ticket_chargeback_cases(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_chargeback_pending_manager_notify
  ON public.ticket_chargeback_cases(created_at ASC)
  WHERE manager_notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_chargeback_pending_admin_notify
  ON public.ticket_chargeback_cases(created_at ASC)
  WHERE admin_notified_at IS NULL;

ALTER TABLE public.ticket_chargeback_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_chargeback_admin_select ON public.ticket_chargeback_cases;
CREATE POLICY ticket_chargeback_admin_select
  ON public.ticket_chargeback_cases FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS ticket_chargeback_manager_select ON public.ticket_chargeback_cases;
CREATE POLICY ticket_chargeback_manager_select
  ON public.ticket_chargeback_cases FOR SELECT TO authenticated
  USING (
    company_id IS NOT NULL
    AND public.user_owns_company(company_id, auth.uid())
  );

GRANT SELECT ON public.ticket_chargeback_cases TO authenticated;

CREATE TABLE IF NOT EXISTS public.manager_ticket_chargeback_debt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_case_id UUID NOT NULL UNIQUE
    REFERENCES public.ticket_chargeback_cases(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  manager_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_due NUMERIC(12, 2) NOT NULL CHECK (amount_due >= 0),
  amount_applied NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_applied >= 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partial', 'settled', 'waived')),
  waived_at TIMESTAMPTZ,
  waived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  waive_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT manager_ticket_cb_debt_applied_lte_due CHECK (amount_applied <= amount_due)
);

CREATE INDEX IF NOT EXISTS idx_manager_ticket_cb_debt_open
  ON public.manager_ticket_chargeback_debt(company_id, created_at ASC)
  WHERE status IN ('open', 'partial');

ALTER TABLE public.manager_ticket_chargeback_debt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manager_ticket_cb_debt_admin_select ON public.manager_ticket_chargeback_debt;
CREATE POLICY manager_ticket_cb_debt_admin_select
  ON public.manager_ticket_chargeback_debt FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS manager_ticket_cb_debt_manager_select ON public.manager_ticket_chargeback_debt;
CREATE POLICY manager_ticket_cb_debt_manager_select
  ON public.manager_ticket_chargeback_debt FOR SELECT TO authenticated
  USING (public.user_owns_company(company_id, auth.uid()));

GRANT SELECT ON public.manager_ticket_chargeback_debt TO authenticated;

CREATE TABLE IF NOT EXISTS public.manager_ticket_chargeback_debt_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id UUID NOT NULL REFERENCES public.manager_ticket_chargeback_debt(id) ON DELETE RESTRICT,
  payout_batch_id UUID REFERENCES public.credit_payout_batches(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_manager_ticket_cb_debt_apps_debt
  ON public.manager_ticket_chargeback_debt_applications(debt_id, created_at DESC);

ALTER TABLE public.manager_ticket_chargeback_debt_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manager_ticket_cb_debt_apps_admin ON public.manager_ticket_chargeback_debt_applications;
CREATE POLICY manager_ticket_cb_debt_apps_admin
  ON public.manager_ticket_chargeback_debt_applications FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

GRANT SELECT ON public.manager_ticket_chargeback_debt_applications TO authenticated;

ALTER TABLE public.financial_splits
  ADD COLUMN IF NOT EXISTS reversed_by_chargeback_case_id UUID
    REFERENCES public.ticket_chargeback_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_financial_splits_reversed_cb
  ON public.financial_splits(reversed_by_chargeback_case_id)
  WHERE reversed_by_chargeback_case_id IS NOT NULL;

ALTER TABLE public.credit_payout_batches
  ADD COLUMN IF NOT EXISTS gross_settlement_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS ticket_chargeback_deduction NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2) RPC principal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ticket_handle_mp_chargeback(
  p_receivable_id UUID,
  p_mp_payment_id TEXT,
  p_mp_status TEXT DEFAULT 'charged_back',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recv public.receivables%ROWTYPE;
  v_case_id UUID;
  v_idem TEXT;
  v_mp_status TEXT;
  v_reason TEXT;
  v_company_id UUID;
  v_event_title TEXT;
  v_manager_net NUMERIC(12, 2) := 0;
  v_platform_fee NUMERIC(12, 2) := 0;
  v_gross NUMERIC(12, 2) := 0;
  v_cancelled INTEGER := 0;
  v_already_used BOOLEAN := false;
  v_needs_review BOOLEAN := false;
  v_analytics_ids UUID[];
  v_debt_id UUID;
  v_is_partial BOOLEAN := false;
BEGIN
  IF p_receivable_id IS NULL OR p_mp_payment_id IS NULL OR trim(p_mp_payment_id) = '' THEN
    RAISE EXCEPTION 'Parâmetros inválidos para chargeback de ingresso.';
  END IF;

  v_mp_status := COALESCE(NULLIF(trim(p_mp_status), ''), 'charged_back');
  v_is_partial := (v_mp_status = 'partially_refunded');
  v_reason := COALESCE(
    NULLIF(trim(p_reason), ''),
    format('Chargeback Mercado Pago na compra de ingresso (%s).', v_mp_status)
  );
  v_idem := 'ticket_chargeback:' || trim(p_mp_payment_id);

  SELECT id INTO v_case_id
  FROM public.ticket_chargeback_cases
  WHERE idempotency_key = v_idem OR mp_payment_id = trim(p_mp_payment_id);

  IF v_case_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'chargeback_case_id', v_case_id);
  END IF;

  SELECT * INTO v_recv
  FROM public.receivables
  WHERE id = p_receivable_id
  FOR UPDATE;

  IF v_recv.id IS NULL THEN
    RAISE EXCEPTION 'Receivable não encontrado.';
  END IF;

  IF v_recv.status = 'refunded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'reason', 'already_refunded',
      'receivable_id', v_recv.id
    );
  END IF;

  IF v_recv.status <> 'paid' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', true,
      'reason', 'not_paid',
      'status', v_recv.status,
      'receivable_id', v_recv.id
    );
  END IF;

  IF v_recv.mp_payment_id IS NOT NULL
     AND trim(v_recv.mp_payment_id) <> trim(p_mp_payment_id) THEN
    RAISE EXCEPTION 'mp_payment_id não corresponde ao receivable.';
  END IF;

  IF v_is_partial THEN
    v_needs_review := true;
  END IF;

  SELECT e.company_id, e.title
  INTO v_company_id, v_event_title
  FROM public.events e
  WHERE e.id = v_recv.event_id;

  SELECT COALESCE(SUM(fs.manager_amount), 0), COALESCE(SUM(fs.platform_amount), 0)
  INTO v_manager_net, v_platform_fee
  FROM public.financial_splits fs
  WHERE fs.transaction_id = v_recv.id
    AND fs.reversed_by_chargeback_case_id IS NULL;

  v_gross := round(COALESCE(NULLIF(v_recv.gross_amount, 0), v_recv.total_value, 0), 2);
  IF v_manager_net <= 0 THEN
    v_manager_net := round(
      greatest(0, COALESCE(v_recv.net_amount_after_mp, 0) - COALESCE(v_recv.platform_fee_amount, 0)),
      2
    );
  END IF;
  IF v_platform_fee <= 0 THEN
    v_platform_fee := round(COALESCE(v_recv.platform_fee_amount, 0), 2);
  END IF;

  v_analytics_ids := COALESCE(v_recv.wristband_analytics_ids, ARRAY[]::uuid[]);

  IF cardinality(v_analytics_ids) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.wristband_analytics wa
      WHERE wa.id = ANY (v_analytics_ids)
        AND wa.status = 'used'
    ) INTO v_already_used;

    IF NOT v_is_partial THEN
      UPDATE public.wristband_analytics wa
      SET status = 'cancelled'
      WHERE wa.id = ANY (v_analytics_ids)
        AND wa.status IS DISTINCT FROM 'cancelled';

      GET DIAGNOSTICS v_cancelled = ROW_COUNT;

      UPDATE public.wristbands w
      SET status = 'cancelled'
      WHERE w.id IN (
        SELECT wa.wristband_id
        FROM public.wristband_analytics wa
        WHERE wa.id = ANY (v_analytics_ids)
          AND wa.wristband_id IS NOT NULL
      )
      AND w.status IS DISTINCT FROM 'cancelled';
    END IF;
  END IF;

  INSERT INTO public.ticket_chargeback_cases (
    receivable_id,
    event_id,
    company_id,
    client_user_id,
    manager_user_id,
    mp_payment_id,
    mp_status,
    gross_amount,
    platform_fee_amount,
    manager_net_amount,
    tickets_cancelled_count,
    already_checked_in,
    needs_manual_review,
    reason,
    idempotency_key,
    metadata
  ) VALUES (
    v_recv.id,
    v_recv.event_id,
    v_company_id,
    v_recv.client_user_id,
    v_recv.manager_user_id,
    trim(p_mp_payment_id),
    v_mp_status,
    v_gross,
    round(v_platform_fee, 2),
    round(v_manager_net, 2),
    v_cancelled,
    COALESCE(v_already_used, false),
    v_needs_review,
    v_reason,
    v_idem,
    jsonb_build_object(
      'event_title', v_event_title,
      'analytics_ids', to_jsonb(v_analytics_ids),
      'partial', v_is_partial
    )
  )
  RETURNING id INTO v_case_id;

  UPDATE public.financial_splits
  SET reversed_by_chargeback_case_id = v_case_id
  WHERE transaction_id = v_recv.id
    AND reversed_by_chargeback_case_id IS NULL;

  UPDATE public.receivables
  SET
    status = CASE WHEN v_is_partial THEN status ELSE 'refunded' END,
    payment_status = v_mp_status,
    mp_payment_id = COALESCE(mp_payment_id, trim(p_mp_payment_id)),
    updated_at = timezone('utc'::text, now())
  WHERE id = v_recv.id;

  IF v_company_id IS NOT NULL AND round(v_manager_net, 2) > 0 AND NOT v_is_partial THEN
    INSERT INTO public.manager_ticket_chargeback_debt (
      chargeback_case_id,
      company_id,
      manager_user_id,
      amount_due,
      amount_applied,
      status
    ) VALUES (
      v_case_id,
      v_company_id,
      v_recv.manager_user_id,
      round(v_manager_net, 2),
      0,
      'open'
    )
    RETURNING id INTO v_debt_id;
  END IF;

  INSERT INTO public.payment_events (
    transaction_id,
    source,
    payment_status,
    receivable_status,
    payment_status_detail,
    mp_payment_id,
    payload
  ) VALUES (
    v_recv.id,
    'webhook',
    v_mp_status,
    CASE WHEN v_is_partial THEN v_recv.status ELSE 'refunded' END,
    v_reason,
    trim(p_mp_payment_id),
    jsonb_build_object(
      'stage', 'ticket_chargeback',
      'chargeback_case_id', v_case_id,
      'debt_id', v_debt_id,
      'tickets_cancelled', v_cancelled,
      'already_checked_in', v_already_used,
      'needs_manual_review', v_needs_review
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'chargeback_case_id', v_case_id,
    'receivable_id', v_recv.id,
    'company_id', v_company_id,
    'manager_user_id', v_recv.manager_user_id,
    'manager_net_amount', round(v_manager_net, 2),
    'platform_fee_amount', round(v_platform_fee, 2),
    'gross_amount', v_gross,
    'tickets_cancelled_count', v_cancelled,
    'already_checked_in', COALESCE(v_already_used, false),
    'needs_manual_review', v_needs_review,
    'debt_id', v_debt_id,
    'mp_status', v_mp_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ticket_handle_mp_chargeback(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ticket_handle_mp_chargeback(UUID, TEXT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Abatimento na liquidação D+1
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_ticket_chargeback_debts_to_payout(
  p_company_id UUID,
  p_payout_batch_id UUID,
  p_available_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC(12, 2);
  v_applied_total NUMERIC(12, 2) := 0;
  v_row RECORD;
  v_apply NUMERIC(12, 2);
  v_open_due NUMERIC(12, 2);
BEGIN
  v_remaining := round(greatest(COALESCE(p_available_amount, 0), 0), 2);
  IF p_company_id IS NULL OR p_payout_batch_id IS NULL OR v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT d.id, d.amount_due, d.amount_applied
    FROM public.manager_ticket_chargeback_debt d
    WHERE d.company_id = p_company_id
      AND d.status IN ('open', 'partial')
    ORDER BY d.created_at ASC, d.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_open_due := round(v_row.amount_due - v_row.amount_applied, 2);
    IF v_open_due <= 0 THEN
      UPDATE public.manager_ticket_chargeback_debt
      SET status = 'settled', updated_at = timezone('utc'::text, now())
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    v_apply := round(least(v_open_due, v_remaining), 2);
    IF v_apply <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.manager_ticket_chargeback_debt_applications (
      debt_id, payout_batch_id, amount
    ) VALUES (
      v_row.id, p_payout_batch_id, v_apply
    );

    UPDATE public.manager_ticket_chargeback_debt
    SET
      amount_applied = round(amount_applied + v_apply, 2),
      status = CASE
        WHEN round(amount_applied + v_apply, 2) >= amount_due THEN 'settled'
        ELSE 'partial'
      END,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_row.id;

    v_applied_total := round(v_applied_total + v_apply, 2);
    v_remaining := round(v_remaining - v_apply, 2);
  END LOOP;

  RETURN v_applied_total;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ticket_chargeback_debts_to_payout(UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ticket_chargeback_debts_to_payout(UUID, UUID, NUMERIC) TO service_role;

CREATE OR REPLACE FUNCTION public.register_admin_credit_settlement_payment(
  p_company_id UUID,
  p_settlement_ids UUID[] DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'pix',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT auth.uid()
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
  v_method TEXT;
  v_row RECORD;
  v_company_name TEXT;
  v_event_title TEXT;
  v_deduction NUMERIC(12, 2) := 0;
  v_net_total NUMERIC(12, 2);
  v_notes TEXT;
BEGIN
  IF p_company_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master pode registrar liquidação manual.';
  END IF;

  v_method := lower(COALESCE(NULLIF(trim(p_payment_method), ''), 'pix'));
  IF v_method NOT IN ('pix', 'ted', 'mp_transfer', 'other') THEN
    RAISE EXCEPTION 'Meio de pagamento inválido.';
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
    RAISE EXCEPTION 'Nenhum repasse liberado (D+1) disponível para pagamento.';
  END IF;

  v_ref := COALESCE(NULLIF(trim(p_payment_reference), ''), 'EF-MANUAL-' || gen_random_uuid()::text);
  SELECT corporate_name INTO v_company_name FROM public.companies WHERE id = p_company_id;

  v_notes := NULLIF(trim(p_notes), '');

  INSERT INTO public.credit_payout_batches (
    company_id,
    manager_user_id,
    total_amount,
    settlement_count,
    status,
    mp_payout_reference,
    payment_method,
    payment_reference,
    registered_by,
    notes,
    paid_at,
    gross_settlement_amount,
    ticket_chargeback_deduction
  ) VALUES (
    p_company_id,
    p_actor_user_id,
    round(v_total, 2),
    v_count,
    'paid',
    v_ref,
    v_method,
    v_ref,
    p_actor_user_id,
    v_notes,
    timezone('utc'::text, now()),
    round(v_total, 2),
    0
  )
  RETURNING id INTO v_batch_id;

  v_deduction := public.apply_ticket_chargeback_debts_to_payout(
    p_company_id,
    v_batch_id,
    round(v_total, 2)
  );
  v_net_total := round(greatest(0, v_total - COALESCE(v_deduction, 0)), 2);

  IF COALESCE(v_deduction, 0) > 0 THEN
    v_notes := trim(both E'\n' FROM concat_ws(
      E'\n',
      v_notes,
      format(
        'Desconto chargeback ingresso: R$ %s (bruto repasse R$ %s → líquido R$ %s).',
        to_char(v_deduction, 'FM999999990.00'),
        to_char(v_total, 'FM999999990.00'),
        to_char(v_net_total, 'FM999999990.00')
      )
    ));

    UPDATE public.credit_payout_batches
    SET
      total_amount = v_net_total,
      ticket_chargeback_deduction = round(v_deduction, 2),
      gross_settlement_amount = round(v_total, 2),
      notes = v_notes
    WHERE id = v_batch_id;
  END IF;

  FOR v_row IN
    SELECT m.id, m.spend_order_id, m.split_id, m.manager_amount
    FROM public.manager_credit_settlement_ledger m
    WHERE m.company_id = p_company_id
      AND m.status = 'released'
      AND (
        p_settlement_ids IS NULL
        OR COALESCE(array_length(p_settlement_ids, 1), 0) = 0
        OR m.id = ANY (p_settlement_ids)
      )
  LOOP
    UPDATE public.manager_credit_settlement_ledger
    SET
      status = 'paid',
      paid_at = timezone('utc'::text, now()),
      payout_batch_id = v_batch_id,
      mp_payout_reference = v_ref,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_row.id;

    SELECT e.title INTO v_event_title
    FROM public.credit_spend_orders o
    LEFT JOIN public.events e ON e.id = o.receiver_event_id
    WHERE o.id = v_row.spend_order_id;

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
    )
    SELECT
      o.client_user_id,
      'spend',
      'spend_allocation_manager',
      0,
      acc.balance_cached,
      'settlement:manager:' || v_row.id::text,
      o.correlation_id,
      o.receiver_company_id,
      o.receiver_event_id,
      o.receiver_establishment_id,
      'credit_settlement',
      v_row.id,
      format(
        E'**Repasse EventFest (liquidação manual)** — R$ %s pagos a %s%s. Ref.: %s (%s).',
        to_char(v_row.manager_amount, 'FM999999990.00'),
        COALESCE(v_company_name, 'empresa parceira'),
        CASE WHEN v_event_title IS NOT NULL THEN format(' — "%s"', v_event_title) ELSE '' END,
        v_ref,
        upper(v_method)
      ),
      format('Manual settlement | settlement %s | batch %s', v_row.id, v_batch_id),
      jsonb_build_object(
        'manager_amount', v_row.manager_amount,
        'payment_method', v_method,
        'payment_reference', v_ref,
        'payout_batch_id', v_batch_id,
        'informational_only', true,
        'ticket_chargeback_deduction_batch', round(COALESCE(v_deduction, 0), 2)
      )
    FROM public.credit_spend_orders o
    INNER JOIN public.client_credit_accounts acc ON acc.user_id = o.client_user_id
    WHERE o.id = v_row.spend_order_id
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.credit_audit_log (
    event_type,
    subject_user_id,
    company_id,
    reference_type,
    reference_id,
    summary,
    payload
  ) VALUES (
    'manual_settlement_paid',
    p_actor_user_id,
    p_company_id,
    'credit_payout_batch',
    v_batch_id,
    format(
      'Liquidação manual %s — %s itens — bruto R$ %s — desconto chargeback ingresso R$ %s — líquido R$ %s',
      upper(v_method),
      v_count,
      to_char(v_total, 'FM999999990.00'),
      to_char(COALESCE(v_deduction, 0), 'FM999999990.00'),
      to_char(v_net_total, 'FM999999990.00')
    ),
    jsonb_build_object(
      'batch_id', v_batch_id,
      'company_id', p_company_id,
      'payment_method', v_method,
      'payment_reference', v_ref,
      'gross_settlement_amount', round(v_total, 2),
      'ticket_chargeback_deduction', round(COALESCE(v_deduction, 0), 2),
      'total_amount', v_net_total,
      'settlement_count', v_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'gross_settlement_amount', round(v_total, 2),
    'ticket_chargeback_deduction', round(COALESCE(v_deduction, 0), 2),
    'total_amount', v_net_total,
    'settlement_count', v_count,
    'payment_reference', v_ref,
    'payment_method', v_method
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_admin_credit_settlement_payment(UUID, UUID[], TEXT, TEXT, TEXT, UUID) TO authenticated;
