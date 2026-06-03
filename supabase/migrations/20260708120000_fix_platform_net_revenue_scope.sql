-- Ajusta "receita líquida plataforma": recorrente (mensalidade/licença) após MP,
-- sem somar comissões de ingresso/consumo no mesmo total principal.
-- Comissões ficam em bloco separado; consolidado opcional.

CREATE OR REPLACE FUNCTION public.get_admin_platform_billing_revenue(
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
  v_listing_gross NUMERIC(14, 2) := 0;
  v_listing_net NUMERIC(14, 2) := 0;
  v_listing_mp_fees NUMERIC(14, 2) := 0;
  v_license_gross NUMERIC(14, 2) := 0;
  v_license_net NUMERIC(14, 2) := 0;
  v_license_mp_fees NUMERIC(14, 2) := 0;
  v_ticket_commission NUMERIC(14, 2) := 0;
  v_consumption_commission NUMERIC(14, 2) := 0;
  v_listing_pending NUMERIC(14, 2) := 0;
  v_license_pending NUMERIC(14, 2) := 0;
  v_recurring_gross NUMERIC(14, 2) := 0;
  v_recurring_net NUMERIC(14, 2) := 0;
  v_billing_mp_fees NUMERIC(14, 2) := 0;
  v_commission_revenue NUMERIC(14, 2) := 0;
  v_platform_revenue_gross NUMERIC(14, 2) := 0;
  v_platform_revenue_net NUMERIC(14, 2) := 0;
  v_consolidated_net NUMERIC(14, 2) := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(public._billing_charge_net_received(amount, mp_fee_amount, net_received_amount)), 0),
    COALESCE(SUM(COALESCE(mp_fee_amount, round(amount * public.get_credit_mp_fee_estimate_pct(), 2))), 0)
  INTO
    v_listing_gross,
    v_listing_net,
    v_listing_mp_fees
  FROM public.company_listing_monthly_charges
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(public._billing_charge_net_received(amount, mp_fee_amount, net_received_amount)), 0),
    COALESCE(SUM(COALESCE(mp_fee_amount, round(amount * public.get_credit_mp_fee_estimate_pct(), 2))), 0)
  INTO
    v_license_gross,
    v_license_net,
    v_license_mp_fees
  FROM public.company_consumption_license_charges
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT COALESCE(SUM(amount), 0)
    INTO v_listing_pending
  FROM public.company_listing_monthly_charges
  WHERE status = 'pending';

  SELECT COALESCE(SUM(amount), 0)
    INTO v_license_pending
  FROM public.company_consumption_license_charges
  WHERE status = 'pending';

  -- Comissão de ingressos: usar financial_splits (fonte contábil), não receivables.platform_fee_amount.
  SELECT COALESCE(SUM(fs.platform_amount), 0)
    INTO v_ticket_commission
  FROM public.financial_splits fs
  INNER JOIN public.receivables r ON r.id = fs.transaction_id
  WHERE fs.platform_amount > 0
    AND (
      COALESCE(r.status, '') = 'paid'
      OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
    )
    AND (p_start_date IS NULL OR r.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR r.created_at::date <= p_end_date);

  SELECT COALESCE(SUM(s.platform_amount), 0)
    INTO v_consumption_commission
  FROM public.credit_spend_orders o
  INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
  WHERE o.status = 'completed'
    AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR o.created_at::date <= p_end_date);

  v_recurring_gross := round(v_listing_gross + v_license_gross, 2);
  v_recurring_net := round(v_listing_net + v_license_net, 2);
  v_billing_mp_fees := round(v_listing_mp_fees + v_license_mp_fees, 2);
  v_commission_revenue := round(v_ticket_commission + v_consumption_commission, 2);
  v_platform_revenue_gross := round(v_recurring_gross + v_commission_revenue, 2);
  -- Receita líquida principal = só recorrente após taxas MP (mensalidade + licença).
  v_platform_revenue_net := v_recurring_net;
  v_consolidated_net := round(v_recurring_net + v_commission_revenue, 2);

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'listing_monthly', jsonb_build_object(
      'paid_revenue', v_listing_gross,
      'paid_revenue_net', v_listing_net,
      'mp_fees', v_listing_mp_fees,
      'pending_amount', v_listing_pending
    ),
    'consumption_license', jsonb_build_object(
      'paid_revenue', v_license_gross,
      'paid_revenue_net', v_license_net,
      'mp_fees', v_license_mp_fees,
      'pending_amount', v_license_pending
    ),
    'ticket_commission', jsonb_build_object(
      'revenue', v_ticket_commission
    ),
    'consumption_commission', jsonb_build_object(
      'revenue', v_consumption_commission
    ),
    'totals', jsonb_build_object(
      'recurring_revenue_gross', v_recurring_gross,
      'recurring_revenue_net', v_recurring_net,
      'billing_mp_fees', v_billing_mp_fees,
      'commission_revenue', v_commission_revenue,
      'platform_revenue_gross', v_platform_revenue_gross,
      'platform_revenue_net', v_platform_revenue_net,
      'consolidated_revenue_net', v_consolidated_net,
      'platform_revenue', v_platform_revenue_net,
      'recurring_revenue', v_recurring_net
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_platform_billing_revenue(DATE, DATE) TO authenticated;
