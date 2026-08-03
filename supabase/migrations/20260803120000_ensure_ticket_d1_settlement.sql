-- Garante lançamento D+1 de ingresso (bank_transfer) mesmo quando
-- settlement_channel/collector_type ficaram NULL no receivable.
-- Idempotente; corrige splits inconsistentes (líquido = bruto no modo D+1).

CREATE OR REPLACE FUNCTION public.create_ticket_settlement_from_receivable(
  p_receivable_id UUID,
  p_company_id UUID,
  p_event_id UUID,
  p_gross_amount NUMERIC,
  p_platform_fee NUMERIC,
  p_mp_fee_amount NUMERIC,
  p_manager_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention INTEGER;
  v_id UUID;
  v_manager NUMERIC(12, 2);
  v_base_at TIMESTAMPTZ;
BEGIN
  IF p_receivable_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'Receivable/empresa inválidos.';
  END IF;

  v_manager := round(COALESCE(p_manager_amount, 0), 2);
  IF v_manager <= 0 THEN
    RETURN NULL;
  END IF;

  v_retention := public.get_credit_settlement_retention_days();

  SELECT COALESCE(r.paid_at, r.created_at, timezone('utc'::text, now()))
  INTO v_base_at
  FROM public.receivables r
  WHERE r.id = p_receivable_id;

  v_base_at := COALESCE(v_base_at, timezone('utc'::text, now()));

  INSERT INTO public.manager_ticket_settlement_ledger (
    company_id,
    event_id,
    receivable_id,
    gross_amount,
    platform_fee,
    mp_fee_amount,
    manager_amount,
    status,
    release_at
  ) VALUES (
    p_company_id,
    p_event_id,
    p_receivable_id,
    round(COALESCE(p_gross_amount, 0), 2),
    round(COALESCE(p_platform_fee, 0), 2),
    round(COALESCE(p_mp_fee_amount, 0), 2),
    v_manager,
    'pending',
    v_base_at + make_interval(days => v_retention)
  )
  ON CONFLICT (receivable_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.manager_ticket_settlement_ledger
    WHERE receivable_id = p_receivable_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_ticket_d1_settlement_for_receivable(
  p_receivable_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_mode TEXT;
  v_is_d1 BOOLEAN := false;
  v_gross NUMERIC(14, 2);
  v_mp_fee NUMERIC(14, 2);
  v_platform NUMERIC(14, 2);
  v_manager NUMERIC(14, 2);
  v_pct NUMERIC(6, 2);
  v_settlement_id UUID;
  v_created BOOLEAN := false;
  v_channel_fixed BOOLEAN := false;
  v_splits_fixed BOOLEAN := false;
  v_existing_mgr NUMERIC(14, 2);
BEGIN
  IF p_receivable_id IS NULL THEN
    RAISE EXCEPTION 'Receivable inválido.';
  END IF;

  IF NOT (
    auth.role() = 'service_role'
    OR public.user_is_admin_master_for_rls()
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT
    r.id,
    r.status,
    r.payment_status,
    r.settlement_channel,
    r.collector_type,
    r.total_value,
    r.gross_amount,
    r.mp_fee_amount,
    r.platform_fee_amount,
    r.event_id,
    r.manager_user_id,
    e.company_id,
    e.applied_percentage,
    t.id AS settlement_id,
    t.manager_amount AS settlement_manager_amount
  INTO v_row
  FROM public.receivables r
  LEFT JOIN public.events e ON e.id = r.event_id
  LEFT JOIN public.manager_ticket_settlement_ledger t ON t.receivable_id = r.id
  WHERE r.id = p_receivable_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'receivable_not_found');
  END IF;

  IF NOT (
    COALESCE(v_row.status, '') = 'paid'
    OR COALESCE(v_row.payment_status, '') IN ('approved', 'authorized')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paid');
  END IF;

  IF v_row.company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_company');
  END IF;

  v_mode := public.get_company_ticket_checkout_mode(v_row.company_id);
  v_is_d1 :=
    COALESCE(v_row.settlement_channel, '') = 'manual_d1'
    OR COALESCE(v_row.collector_type, '') = 'platform'
    OR v_mode = 'bank_transfer';

  IF NOT v_is_d1 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'skipped_mp_split',
      'checkout_mode', v_mode,
      'settlement_id', v_row.settlement_id
    );
  END IF;

  v_gross := round(COALESCE(NULLIF(v_row.gross_amount, 0), v_row.total_value, 0), 2);
  IF v_gross <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_gross');
  END IF;

  v_pct := COALESCE(v_row.applied_percentage, 0);
  v_mp_fee := round(COALESCE(v_row.mp_fee_amount, 0), 2);
  v_platform := round(
    COALESCE(NULLIF(v_row.platform_fee_amount, 0), v_gross * (v_pct / 100.0)),
    2
  );
  v_manager := greatest(round(v_gross - v_mp_fee - v_platform, 2), 0);

  IF COALESCE(v_row.settlement_channel, '') IS DISTINCT FROM 'manual_d1'
     OR COALESCE(v_row.collector_type, '') IS DISTINCT FROM 'platform'
     OR COALESCE(v_row.platform_fee_amount, -1) IS DISTINCT FROM v_platform
  THEN
    UPDATE public.receivables
    SET
      settlement_channel = 'manual_d1',
      collector_type = 'platform',
      platform_fee_amount = v_platform
    WHERE id = p_receivable_id;
    v_channel_fixed := true;
  END IF;

  -- Corrige splits no padrão mp_split (líquido gestor = bruto) quando o modo é D+1.
  SELECT fs.manager_amount
  INTO v_existing_mgr
  FROM public.financial_splits fs
  WHERE fs.transaction_id = p_receivable_id
    AND fs.manager_amount > 0
  ORDER BY fs.manager_amount DESC
  LIMIT 1;

  IF v_existing_mgr IS NOT NULL AND v_existing_mgr IS DISTINCT FROM v_manager THEN
    UPDATE public.financial_splits
    SET manager_amount = v_manager
    WHERE transaction_id = p_receivable_id
      AND manager_amount > 0
      AND platform_amount = 0;

    UPDATE public.financial_splits
    SET platform_amount = v_platform
    WHERE transaction_id = p_receivable_id
      AND platform_amount > 0
      AND manager_amount = 0;

    v_splits_fixed := true;
  END IF;

  IF v_row.settlement_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'already_exists',
      'settlement_id', v_row.settlement_id,
      'manager_amount', COALESCE(v_row.settlement_manager_amount, v_manager),
      'channel_fixed', v_channel_fixed,
      'splits_fixed', v_splits_fixed
    );
  END IF;

  IF v_manager <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'skipped_zero_manager',
      'channel_fixed', v_channel_fixed,
      'splits_fixed', v_splits_fixed
    );
  END IF;

  v_settlement_id := public.create_ticket_settlement_from_receivable(
    p_receivable_id,
    v_row.company_id,
    v_row.event_id,
    v_gross,
    v_platform,
    v_mp_fee,
    v_manager
  );
  v_created := v_settlement_id IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'action', CASE WHEN v_created THEN 'created' ELSE 'failed' END,
    'settlement_id', v_settlement_id,
    'gross_amount', v_gross,
    'platform_fee', v_platform,
    'mp_fee_amount', v_mp_fee,
    'manager_amount', v_manager,
    'channel_fixed', v_channel_fixed,
    'splits_fixed', v_splits_fixed,
    'checkout_mode', v_mode
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.repair_missing_ticket_d1_settlements(
  p_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_items JSONB := '[]'::jsonb;
  v_result JSONB;
  v_count INTEGER := 0;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR public.user_is_admin_master_for_rls()
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  FOR v_id IN
    SELECT r.id
    FROM public.receivables r
    INNER JOIN public.events e ON e.id = r.event_id
    WHERE (p_company_id IS NULL OR e.company_id = p_company_id)
      AND (
        COALESCE(r.status, '') = 'paid'
        OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
      )
      AND COALESCE(r.payment_gateway_id, '') NOT LIKE 'eventfest_credit:%'
      AND NOT EXISTS (
        SELECT 1
        FROM public.manager_ticket_settlement_ledger t
        WHERE t.receivable_id = r.id
      )
      AND (
        COALESCE(r.settlement_channel, '') = 'manual_d1'
        OR COALESCE(r.collector_type, '') = 'platform'
        OR public.get_company_ticket_checkout_mode(e.company_id) = 'bank_transfer'
      )
    ORDER BY r.created_at
  LOOP
    v_result := public.ensure_ticket_d1_settlement_for_receivable(v_id);
    IF COALESCE(v_result->>'action', '') = 'created' THEN
      v_count := v_count + 1;
    END IF;
    v_items := v_items || jsonb_build_object(
      'receivable_id', v_id,
      'result', v_result
    );
  END LOOP;

  RETURN jsonb_build_object('repaired', v_count, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_ticket_d1_settlement_for_receivable(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_missing_ticket_d1_settlements(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_ticket_d1_settlement_for_receivable(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.repair_missing_ticket_d1_settlements(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_ticket_d1_settlement_for_receivable(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_missing_ticket_d1_settlements(UUID) TO authenticated;

COMMENT ON FUNCTION public.ensure_ticket_d1_settlement_for_receivable(UUID) IS
  'Garante ledger D+1 de ingresso quando a empresa está em bank_transfer (ou canal manual_d1). Idempotente.';
COMMENT ON FUNCTION public.repair_missing_ticket_d1_settlements(UUID) IS
  'Varre recebíveis pagos sem ledger D+1 e repara via ensure_ticket_d1_settlement_for_receivable.';
