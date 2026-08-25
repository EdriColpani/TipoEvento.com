-- manual_d1: comissão EventFest = % do evento (nunca residual MP / marketplace_fee).
-- Repara receivables + financial_splits + ledger desalinhados.

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
  v_ledger_fixed BOOLEAN := false;
  v_existing_mgr NUMERIC(14, 2);
  v_existing_plat NUMERIC(14, 2);
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
    t.manager_amount AS settlement_manager_amount,
    t.platform_fee AS settlement_platform_fee
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
  -- Sempre % do evento no modo banco (não confiar em platform_fee_amount residual do MP).
  v_platform := round(v_gross * (v_pct / 100.0), 2);
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

  SELECT fs.manager_amount, fs.platform_amount
  INTO v_existing_mgr, v_existing_plat
  FROM public.financial_splits fs
  WHERE fs.transaction_id = p_receivable_id
  ORDER BY fs.manager_amount DESC NULLS LAST
  LIMIT 1;

  IF EXISTS (SELECT 1 FROM public.financial_splits WHERE transaction_id = p_receivable_id)
     AND (
       COALESCE(v_existing_mgr, -1) IS DISTINCT FROM v_manager
       OR COALESCE(
            (SELECT max(platform_amount) FROM public.financial_splits WHERE transaction_id = p_receivable_id),
            -1
          ) IS DISTINCT FROM v_platform
     )
  THEN
    UPDATE public.financial_splits
    SET manager_amount = v_manager
    WHERE transaction_id = p_receivable_id
      AND manager_amount > 0
      AND platform_amount = 0;

    UPDATE public.financial_splits
    SET platform_amount = v_platform
    WHERE transaction_id = p_receivable_id
      AND platform_amount >= 0
      AND manager_amount = 0;

    v_splits_fixed := true;
  END IF;

  IF v_row.settlement_id IS NOT NULL THEN
    IF COALESCE(v_row.settlement_manager_amount, -1) IS DISTINCT FROM v_manager
       OR COALESCE(v_row.settlement_platform_fee, -1) IS DISTINCT FROM v_platform
    THEN
      UPDATE public.manager_ticket_settlement_ledger
      SET
        platform_fee = v_platform,
        mp_fee_amount = v_mp_fee,
        manager_amount = v_manager,
        gross_amount = v_gross,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_row.settlement_id
        AND paid_at IS NULL;
      v_ledger_fixed := true;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'already_exists',
      'settlement_id', v_row.settlement_id,
      'manager_amount', v_manager,
      'platform_fee', v_platform,
      'channel_fixed', v_channel_fixed,
      'splits_fixed', v_splits_fixed,
      'ledger_fixed', v_ledger_fixed
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

CREATE OR REPLACE FUNCTION public.admin_backfill_missing_financial_splits(
  p_receivable_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_pct NUMERIC(6, 2);
  v_gross NUMERIC(14, 2);
  v_mp_fee NUMERIC(14, 2);
  v_platform NUMERIC(14, 2);
  v_manager NUMERIC(14, 2);
  v_items JSONB := '[]'::jsonb;
  v_count INTEGER := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.user_is_admin_master_for_rls()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  FOR v_row IN
    SELECT
      r.id,
      r.event_id,
      r.manager_user_id,
      r.gross_amount,
      r.total_value,
      r.mp_fee_amount,
      r.platform_fee_amount,
      r.net_amount_after_mp,
      r.settlement_channel,
      e.applied_percentage
    FROM public.receivables r
    INNER JOIN public.events e ON e.id = r.event_id
    WHERE (p_receivable_id IS NULL OR r.id = p_receivable_id)
      AND (
        COALESCE(r.status, '') = 'paid'
        OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
      )
      AND COALESCE(r.payment_gateway_id, '') NOT LIKE 'eventfest_credit:%'
      AND r.manager_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.financial_splits fs WHERE fs.transaction_id = r.id
      )
  LOOP
    v_gross := round(COALESCE(v_row.gross_amount, v_row.total_value, 0), 2);
    CONTINUE WHEN v_gross <= 0;

    v_pct := COALESCE(v_row.applied_percentage, 0);
    v_mp_fee := round(COALESCE(v_row.mp_fee_amount, 0), 2);

    IF v_row.settlement_channel = 'manual_d1' THEN
      v_platform := round(v_gross * (v_pct / 100.0), 2);
      v_manager := greatest(round(v_gross - v_mp_fee - v_platform, 2), 0);
    ELSE
      v_platform := round(
        COALESCE(NULLIF(v_row.platform_fee_amount, 0), v_gross * (v_pct / 100.0)),
        2
      );
      v_manager := greatest(
        round(COALESCE(v_row.net_amount_after_mp, v_gross - v_mp_fee - v_platform), 2),
        0
      );
    END IF;

    INSERT INTO public.financial_splits (
      transaction_id, event_id, manager_user_id,
      platform_amount, manager_amount, total_amount, applied_percentage
    ) VALUES
      (v_row.id, v_row.event_id, v_row.manager_user_id, 0, v_manager, v_gross, v_pct),
      (v_row.id, v_row.event_id, v_row.manager_user_id, v_platform, 0, v_gross, v_pct);

    v_count := v_count + 1;
    v_items := v_items || jsonb_build_object(
      'receivable_id', v_row.id,
      'gross_amount', v_gross,
      'platform_amount', v_platform,
      'manager_amount', v_manager,
      'applied_percentage', v_pct
    );
  END LOOP;

  RETURN jsonb_build_object('backfilled', v_count, 'items', v_items);
END;
$$;

-- Reparo em lote: receivables/splits/ledger manual_d1 com comissão ≠ do %.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT r.id
    FROM public.receivables r
    WHERE COALESCE(r.settlement_channel, '') = 'manual_d1'
      AND (
        COALESCE(r.status, '') = 'paid'
        OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
      )
  LOOP
    PERFORM public.ensure_ticket_d1_settlement_for_receivable(r.id);
  END LOOP;
END;
$$;
