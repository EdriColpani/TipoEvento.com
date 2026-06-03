-- Corrige relatório de receita da plataforma: separa bruto x líquido e persiste taxas MP
-- em mensalidades/licenças (antes somava valor bruto cobrado + comissões).

ALTER TABLE public.company_listing_monthly_charges
  ADD COLUMN IF NOT EXISTS mp_fee_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS net_received_amount NUMERIC(10, 2);

ALTER TABLE public.company_consumption_license_charges
  ADD COLUMN IF NOT EXISTS mp_fee_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS net_received_amount NUMERIC(10, 2);

COMMENT ON COLUMN public.company_listing_monthly_charges.mp_fee_amount IS
  'Taxa de processamento Mercado Pago no pagamento da mensalidade.';
COMMENT ON COLUMN public.company_listing_monthly_charges.net_received_amount IS
  'Valor líquido creditado na conta EventFest após taxa MP.';
COMMENT ON COLUMN public.company_consumption_license_charges.mp_fee_amount IS
  'Taxa de processamento Mercado Pago no pagamento da licença.';
COMMENT ON COLUMN public.company_consumption_license_charges.net_received_amount IS
  'Valor líquido creditado na conta EventFest após taxa MP.';

CREATE OR REPLACE FUNCTION public._billing_charge_net_received(
  p_amount NUMERIC,
  p_mp_fee_amount NUMERIC,
  p_net_received_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    COALESCE(
      p_net_received_amount,
      p_amount - COALESCE(
        p_mp_fee_amount,
        round(p_amount * public.get_credit_mp_fee_estimate_pct(), 2)
      )
    ),
    2
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_listing_monthly_charge_payment(
  p_charge_id UUID,
  p_mp_payment_id TEXT DEFAULT NULL,
  p_mp_fee_amount NUMERIC DEFAULT NULL,
  p_net_received_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge RECORD;
BEGIN
  UPDATE public.company_listing_monthly_charges
  SET
    status = 'paid',
    paid_at = timezone('utc'::text, now()),
    mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
    mp_fee_amount = COALESCE(p_mp_fee_amount, mp_fee_amount),
    net_received_amount = COALESCE(
      p_net_received_amount,
      net_received_amount,
      public._billing_charge_net_received(amount, p_mp_fee_amount, NULL)
    ),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
    AND status = 'pending'
  RETURNING * INTO v_charge;

  IF v_charge.id IS NULL THEN
    SELECT * INTO v_charge
    FROM public.company_listing_monthly_charges
    WHERE id = p_charge_id;

    IF v_charge.id IS NULL THEN
      RAISE EXCEPTION 'Cobrança não encontrada.';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', v_charge.status, 'idempotent', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'paid', 'charge_id', v_charge.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_consumption_license_charge_payment(
  p_charge_id UUID,
  p_mp_payment_id TEXT DEFAULT NULL,
  p_mp_fee_amount NUMERIC DEFAULT NULL,
  p_net_received_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge RECORD;
BEGIN
  UPDATE public.company_consumption_license_charges
  SET
    status = 'paid',
    paid_at = timezone('utc'::text, now()),
    mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
    mp_fee_amount = COALESCE(p_mp_fee_amount, mp_fee_amount),
    net_received_amount = COALESCE(
      p_net_received_amount,
      net_received_amount,
      public._billing_charge_net_received(amount, p_mp_fee_amount, NULL)
    ),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
    AND status = 'pending'
  RETURNING * INTO v_charge;

  IF v_charge.id IS NULL THEN
    SELECT * INTO v_charge
    FROM public.company_consumption_license_charges
    WHERE id = p_charge_id;

    IF v_charge.id IS NULL THEN
      RAISE EXCEPTION 'Cobrança não encontrada.';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', v_charge.status, 'idempotent', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'paid', 'charge_id', v_charge.id);
END;
$$;

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

  SELECT COALESCE(SUM(r.platform_fee_amount), 0)
    INTO v_ticket_commission
  FROM public.receivables r
  WHERE (
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
  v_platform_revenue_net := round(v_recurring_net + v_commission_revenue, 2);

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
      'platform_revenue', v_platform_revenue_net,
      'recurring_revenue', v_recurring_net
    )
  );
END;
$$;

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
  v_billing_revenue JSONB;
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

  v_billing_revenue := public.get_admin_platform_billing_revenue(p_start_date, p_end_date);

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
    'platform_billing', v_billing_revenue,
    'mp_costs', jsonb_build_object(
      'topup_mp_fees', v_topup_fees,
      'topup_net_cash', v_topup_net_cash,
      'billing_mp_fees', COALESCE((v_billing_revenue->'totals'->>'billing_mp_fees')::numeric, 0),
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

GRANT EXECUTE ON FUNCTION public._billing_charge_net_received(NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_platform_billing_revenue(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_credit_financial_position(DATE, DATE) TO authenticated;
