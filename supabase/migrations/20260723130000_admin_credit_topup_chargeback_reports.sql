-- Relatórios admin: chargebacks de recarga de crédito

CREATE OR REPLACE FUNCTION public.get_admin_credit_topup_chargeback_summary(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_cases INTEGER := 0;
  v_cases_with_absorb INTEGER := 0;
  v_total_credit NUMERIC(14, 2) := 0;
  v_total_wallet NUMERIC(14, 2) := 0;
  v_total_clawback NUMERIC(14, 2) := 0;
  v_total_absorb NUMERIC(14, 2) := 0;
  v_last_at TIMESTAMPTZ;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE c.platform_absorb > 0)::integer,
    COALESCE(SUM(c.credit_granted_amount), 0),
    COALESCE(SUM(c.wallet_debit), 0),
    COALESCE(SUM(c.clawback_manager_total), 0),
    COALESCE(SUM(c.platform_absorb), 0),
    MAX(c.created_at)
  INTO
    v_total_cases,
    v_cases_with_absorb,
    v_total_credit,
    v_total_wallet,
    v_total_clawback,
    v_total_absorb,
    v_last_at
  FROM public.credit_topup_chargeback_cases c
  WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR c.created_at::date <= p_end_date);

  RETURN jsonb_build_object(
    'total_cases', v_total_cases,
    'cases_with_platform_absorb', v_cases_with_absorb,
    'total_credit_granted', round(v_total_credit, 2),
    'total_wallet_debit', round(v_total_wallet, 2),
    'total_clawback_manager', round(v_total_clawback, 2),
    'total_platform_absorb', round(v_total_absorb, 2),
    'last_chargeback_at', v_last_at,
    'has_platform_loss_alert', v_total_absorb > 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_topup_chargebacks(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_platform_absorb_only BOOLEAN DEFAULT FALSE,
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
  v_total INTEGER := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_total
  FROM public.credit_topup_chargeback_cases c
  WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
    AND (NOT COALESCE(p_platform_absorb_only, false) OR c.platform_absorb > 0);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.topup_order_id,
      c.client_user_id,
      c.mp_payment_id,
      c.mp_status,
      c.credit_granted_amount,
      c.wallet_debit,
      c.clawback_manager_total,
      c.platform_absorb,
      c.clawback_settlement_count,
      c.reason,
      c.ledger_entry_id,
      c.created_at,
      t.gross_paid_amount,
      t.origin_company_id,
      co.corporate_name AS origin_company_name,
      t.paid_at AS topup_paid_at
    FROM public.credit_topup_chargeback_cases c
    INNER JOIN public.credit_topup_orders t ON t.id = c.topup_order_id
    LEFT JOIN public.companies co ON co.id = t.origin_company_id
    WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
      AND (NOT COALESCE(p_platform_absorb_only, false) OR c.platform_absorb > 0)
    ORDER BY c.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object(
    'items', v_rows,
    'total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_credit_topup_chargeback_summary(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_credit_topup_chargebacks(DATE, DATE, BOOLEAN, INTEGER, INTEGER) TO authenticated;
