-- Posição financeira consolidada (admin master)
-- Objetivo: separar passivo de cliente, comissão da plataforma e custos MP.

CREATE OR REPLACE FUNCTION public.get_admin_credit_financial_position(
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
  v_liability_now NUMERIC(14,2) := 0;
  v_wallet_balances NUMERIC(14,2) := 0;
  v_topup_gross NUMERIC(14,2) := 0;
  v_topup_fees NUMERIC(14,2) := 0;
  v_topup_net_cash NUMERIC(14,2) := 0;
  v_topup_credit_granted NUMERIC(14,2) := 0;
  v_spend_gross NUMERIC(14,2) := 0;
  v_platform_commission NUMERIC(14,2) := 0;
  v_manager_net NUMERIC(14,2) := 0;
  v_refund_total NUMERIC(14,2) := 0;
  v_mp_disbursed_total NUMERIC(14,2) := 0;
  v_mp_disbursed_failed NUMERIC(14,2) := 0;
  v_expected_liability NUMERIC(14,2) := 0;
  v_available_operational NUMERIC(14,2) := 0;
  v_estimated_mp_position NUMERIC(14,2) := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(outstanding_amount, 0)
    INTO v_liability_now
  FROM public.platform_credit_liability
  WHERE id = 1;

  SELECT COALESCE(SUM(balance_cached), 0)
    INTO v_wallet_balances
  FROM public.client_credit_accounts
  WHERE status = 'active';

  SELECT
    COALESCE(SUM(gross_paid_amount), 0),
    COALESCE(SUM(mp_fee_amount), 0),
    COALESCE(SUM(net_cash_received), 0),
    COALESCE(SUM(credit_granted_amount), 0)
  INTO
    v_topup_gross,
    v_topup_fees,
    v_topup_net_cash,
    v_topup_credit_granted
  FROM public.credit_topup_orders t
  WHERE t.status = 'paid'
    AND (p_start_date IS NULL OR t.paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR t.paid_at::date <= p_end_date);

  SELECT
    COALESCE(SUM(o.gross_amount), 0),
    COALESCE(SUM(s.platform_amount), 0),
    COALESCE(SUM(s.manager_amount), 0)
  INTO
    v_spend_gross,
    v_platform_commission,
    v_manager_net
  FROM public.credit_spend_orders o
  INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
  WHERE o.status = 'completed'
    AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR o.created_at::date <= p_end_date);

  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_refund_total
  FROM public.credit_refund_cases r
  WHERE r.status = 'completed'
    AND (p_start_date IS NULL OR COALESCE(r.completed_at, r.created_at)::date >= p_start_date)
    AND (p_end_date IS NULL OR COALESCE(r.completed_at, r.created_at)::date <= p_end_date);

  SELECT
    COALESCE(SUM(CASE WHEN d.status = 'completed' THEN d.manager_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN d.status = 'failed' THEN d.manager_amount ELSE 0 END), 0)
  INTO
    v_mp_disbursed_total,
    v_mp_disbursed_failed
  FROM public.credit_mp_disbursements d
  WHERE (p_start_date IS NULL OR d.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR d.created_at::date <= p_end_date);

  v_expected_liability := round(v_topup_credit_granted - v_spend_gross - v_refund_total, 2);
  v_available_operational := round(v_topup_net_cash - v_liability_now, 2);
  v_estimated_mp_position := round(v_topup_net_cash - v_mp_disbursed_total, 2);

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'client_credit', jsonb_build_object(
      'liability_now', v_liability_now,
      'wallet_balances', v_wallet_balances,
      'expected_liability_from_period', v_expected_liability
    ),
    'platform_revenue', jsonb_build_object(
      'platform_commission', v_platform_commission,
      'spend_gross', v_spend_gross,
      'manager_net', v_manager_net
    ),
    'mp_costs', jsonb_build_object(
      'topup_mp_fees', v_topup_fees,
      'topup_net_cash', v_topup_net_cash,
      'mp_disbursed_total', v_mp_disbursed_total,
      'mp_disbursed_failed', v_mp_disbursed_failed
    ),
    'managerial_position', jsonb_build_object(
      'available_operational_cash', v_available_operational,
      'estimated_mp_wallet_position', v_estimated_mp_position
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_credit_financial_position(DATE, DATE) TO authenticated;
