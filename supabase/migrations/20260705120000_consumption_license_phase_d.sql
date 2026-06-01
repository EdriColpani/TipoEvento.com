-- Fase D: recorrência mensal licença consumo, RPCs admin e receita consolidada da plataforma

CREATE OR REPLACE FUNCTION public.admin_create_consumption_license_charge(
  p_company_id UUID,
  p_reference_month DATE,
  p_amount NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_amount NUMERIC(10, 2);
  v_month DATE;
  v_charge_id UUID;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode gerar cobranças.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF v_company.billing_plan IS DISTINCT FROM 'consumption_or_license'::public.billing_plan_type THEN
    RAISE EXCEPTION 'Empresa não está no plano consumo/licença.';
  END IF;

  v_month := date_trunc('month', COALESCE(p_reference_month, CURRENT_DATE))::date;
  v_amount := COALESCE(
    p_amount,
    v_company.consumption_license_fee,
    public.get_consumption_license_default_fee(),
    0
  );

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;

  INSERT INTO public.company_consumption_license_charges (
    company_id, reference_month, amount, status, notes, created_by
  ) VALUES (
    p_company_id, v_month, v_amount, 'pending', p_notes, auth.uid()
  )
  ON CONFLICT (company_id, reference_month)
  DO UPDATE SET
    amount = EXCLUDED.amount,
    notes = COALESCE(EXCLUDED.notes, company_consumption_license_charges.notes),
    updated_at = timezone('utc'::text, now())
  RETURNING id INTO v_charge_id;

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge_id,
    'reference_month', v_month,
    'amount', v_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_consumption_license_charge_status(
  p_charge_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  IF p_status NOT IN ('pending', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  UPDATE public.company_consumption_license_charges
  SET
    status = p_status,
    notes = COALESCE(p_notes, notes),
    paid_at = CASE WHEN p_status = 'paid' THEN timezone('utc'::text, now()) ELSE NULL END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada.';
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

-- Gera licenças pendentes do mês para todas as empresas em consumption_or_license
CREATE OR REPLACE FUNCTION public.admin_generate_monthly_consumption_license_charges(
  p_reference_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_company RECORD;
  v_created INTEGER := 0;
  v_skipped_paid INTEGER := 0;
  v_charge JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  v_month := date_trunc('month', COALESCE(p_reference_month, CURRENT_DATE))::date;

  FOR v_company IN
    SELECT id
    FROM public.companies
    WHERE billing_plan = 'consumption_or_license'::public.billing_plan_type
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.company_consumption_license_charges ch
      WHERE ch.company_id = v_company.id
        AND ch.reference_month = v_month
        AND ch.status = 'paid'
    ) THEN
      v_skipped_paid := v_skipped_paid + 1;
      CONTINUE;
    END IF;

    v_charge := public.ensure_consumption_license_charge(v_company.id, v_month);
    IF COALESCE((v_charge->>'already_paid')::boolean, false) THEN
      v_skipped_paid := v_skipped_paid + 1;
    ELSE
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reference_month', v_month,
    'charges_created_or_updated', v_created,
    'skipped_already_paid', v_skipped_paid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_company_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type,
  p_contract_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_contract RECORD;
  v_change_type TEXT;
  v_license JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode usar esta função.';
  END IF;

  IF p_contract_id IS NOT NULL THEN
    PERFORM public.assert_billing_plan_contract_match(p_plan, p_contract_id);
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF p_contract_id IS NOT NULL THEN
    SELECT id, contract_type INTO v_contract FROM public.event_contracts WHERE id = p_contract_id;
    PERFORM public._register_company_billing_acceptance(
      p_company_id,
      p_contract_id,
      v_contract.contract_type
    );
  END IF;

  IF v_company.billing_plan IS NOT NULL
     AND public.billing_plan_rank(p_plan) < public.billing_plan_rank(v_company.billing_plan) THEN
    v_change_type := 'admin_downgrade';
  ELSE
    v_change_type := 'admin_change';
  END IF;

  UPDATE public.companies
  SET
    billing_plan = p_plan,
    billing_contract_id = COALESCE(p_contract_id, billing_contract_id),
    billing_plan_accepted_at = CASE WHEN p_contract_id IS NOT NULL THEN timezone('utc'::text, now()) ELSE billing_plan_accepted_at END,
    requires_billing_reacceptance = false,
    contract_version_accepted_id = COALESCE(p_contract_id, contract_version_accepted_id)
  WHERE id = p_company_id;

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    p_plan,
    auth.uid(),
    v_change_type
  );

  v_license := NULL;
  IF p_plan = 'consumption_or_license'::public.billing_plan_type THEN
    v_license := public.ensure_consumption_license_charge(p_company_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'billing_plan', p_plan,
    'consumption_license', v_license
  );
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
  v_listing_revenue NUMERIC(14, 2) := 0;
  v_license_revenue NUMERIC(14, 2) := 0;
  v_ticket_commission NUMERIC(14, 2) := 0;
  v_consumption_commission NUMERIC(14, 2) := 0;
  v_listing_pending NUMERIC(14, 2) := 0;
  v_license_pending NUMERIC(14, 2) := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_listing_revenue
  FROM public.company_listing_monthly_charges
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT COALESCE(SUM(amount), 0)
    INTO v_license_revenue
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

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'listing_monthly', jsonb_build_object(
      'paid_revenue', v_listing_revenue,
      'pending_amount', v_listing_pending
    ),
    'consumption_license', jsonb_build_object(
      'paid_revenue', v_license_revenue,
      'pending_amount', v_license_pending
    ),
    'ticket_commission', jsonb_build_object(
      'revenue', v_ticket_commission
    ),
    'consumption_commission', jsonb_build_object(
      'revenue', v_consumption_commission
    ),
    'totals', jsonb_build_object(
      'platform_revenue', round(
        v_listing_revenue + v_license_revenue + v_ticket_commission + v_consumption_commission,
        2
      ),
      'recurring_revenue', round(v_listing_revenue + v_license_revenue, 2),
      'commission_revenue', round(v_ticket_commission + v_consumption_commission, 2)
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

GRANT EXECUTE ON FUNCTION public.admin_create_consumption_license_charge(UUID, DATE, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_consumption_license_charge_status(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_monthly_consumption_license_charges(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_platform_billing_revenue(DATE, DATE) TO authenticated;
