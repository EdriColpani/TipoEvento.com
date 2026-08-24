-- Fase 5: totais por meio, “a pagar” só released, cron de liberação, labels de canal vs prazo.

SELECT public.security_open_change_window('settlement phase 5 report audit and release cron', 30);

CREATE OR REPLACE FUNCTION public.settlement_funding_bucket(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(trim(COALESCE(p_type, ''))) = 'credit_card' THEN 'card'
    ELSE 'fast'
  END;
$$;

COMMENT ON FUNCTION public.settlement_funding_bucket(TEXT) IS
  'card = cartão de crédito (D+30/MP); fast = PIX/débito/other (D+1).';

CREATE OR REPLACE FUNCTION public.summarize_settlement_ledgers_by_funding(
  p_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN := false;
BEGIN
  IF p_company_id IS NULL THEN
    v_ok := public.user_is_admin_master_for_rls();
  ELSE
    v_ok := public.user_is_admin_master_for_rls()
      OR public.user_manages_credit_company(p_company_id)
      OR public.user_owns_company(p_company_id, auth.uid());
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'pending_retention_fast', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'pending' AND x.bucket = 'fast'), 0),
      'pending_retention_card', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'pending' AND x.bucket = 'card'), 0),
      'awaiting_payment_fast', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'released' AND x.bucket = 'fast'), 0),
      'awaiting_payment_card', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'released' AND x.bucket = 'card'), 0),
      'paid_fast', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'paid' AND x.bucket = 'fast'), 0),
      'paid_card', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'paid' AND x.bucket = 'card'), 0)
    )
    FROM (
      SELECT
        manager_amount AS amt,
        status AS st,
        public.settlement_funding_bucket(settlement_funding_type) AS bucket
      FROM public.manager_credit_settlement_ledger
      WHERE p_company_id IS NULL OR company_id = p_company_id
      UNION ALL
      SELECT
        manager_amount,
        status,
        public.settlement_funding_bucket(settlement_funding_type)
      FROM public.manager_ticket_settlement_ledger
      WHERE p_company_id IS NULL OR company_id = p_company_id
    ) x
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settlement_funding_bucket(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.summarize_settlement_ledgers_by_funding(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settlement_funding_bucket(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.summarize_settlement_ledgers_by_funding(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_ticket_manual_settlement_totals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_funding JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master.';
  END IF;

  PERFORM public.process_ticket_settlement_releases();

  SELECT jsonb_build_object(
    'pending_retention', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'awaiting_payment', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0),
    'paid', COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN status = 'clawback' THEN manager_amount ELSE 0 END), 0)
  )
  INTO v_result
  FROM public.manager_ticket_settlement_ledger;

  v_funding := public.summarize_settlement_ledgers_by_funding(NULL);

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('by_funding', v_funding);
END;
$$;

-- Fiscal: “a repassar agora” = só released (não misturar cartão ainda em retenção)
CREATE OR REPLACE FUNCTION public.get_admin_fiscal_synthetic_report(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_now NUMERIC(14, 2) := 0;
  v_topup_gross NUMERIC(14, 2) := 0;
  v_topup_granted NUMERIC(14, 2) := 0;
  v_topup_mp NUMERIC(14, 2) := 0;
  v_spend_ticket_gross NUMERIC(14, 2) := 0;
  v_spend_ticket_commission NUMERIC(14, 2) := 0;
  v_spend_ticket_manager NUMERIC(14, 2) := 0;
  v_spend_cons_gross NUMERIC(14, 2) := 0;
  v_spend_cons_commission NUMERIC(14, 2) := 0;
  v_spend_cons_manager NUMERIC(14, 2) := 0;
  v_ticket_mp_gross NUMERIC(14, 2) := 0;
  v_ticket_mp_commission NUMERIC(14, 2) := 0;
  v_ticket_mp_manager NUMERIC(14, 2) := 0;
  v_ticket_mp_fee NUMERIC(14, 2) := 0;
  v_ticket_d1_gross NUMERIC(14, 2) := 0;
  v_ticket_d1_commission NUMERIC(14, 2) := 0;
  v_ticket_d1_manager NUMERIC(14, 2) := 0;
  v_ticket_d1_mp NUMERIC(14, 2) := 0;
  v_listing NUMERIC(14, 2) := 0;
  v_listing_mp NUMERIC(14, 2) := 0;
  v_license NUMERIC(14, 2) := 0;
  v_license_mp NUMERIC(14, 2) := 0;
  v_inactivity NUMERIC(14, 2) := 0;
  v_refunds NUMERIC(14, 2) := 0;
  v_credit_remitted NUMERIC(14, 2) := 0;
  v_ticket_remitted NUMERIC(14, 2) := 0;
  v_credit_awaiting NUMERIC(14, 2) := 0;
  v_ticket_awaiting NUMERIC(14, 2) := 0;
  v_credit_retention NUMERIC(14, 2) := 0;
  v_ticket_retention NUMERIC(14, 2) := 0;
  v_mp_eventfest NUMERIC(14, 2) := 0;
  v_billing_total NUMERIC(14, 2) := 0;
  v_ticket_commission_total NUMERIC(14, 2) := 0;
  v_profit_total NUMERIC(14, 2) := 0;
  v_giro NUMERIC(14, 2) := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();
  PERFORM public.process_ticket_settlement_releases();

  SELECT COALESCE(SUM(balance_cached), 0)
    INTO v_wallet_now
  FROM public.client_credit_accounts;

  SELECT
    COALESCE(SUM(gross_paid_amount), 0),
    COALESCE(SUM(credit_granted_amount), 0),
    COALESCE(SUM(COALESCE(mp_fee_amount, 0)), 0)
  INTO v_topup_gross, v_topup_granted, v_topup_mp
  FROM public.credit_topup_orders
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT
    COALESCE(SUM(CASE WHEN is_ticket THEN gross_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_ticket THEN platform_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_ticket THEN manager_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN NOT is_ticket THEN gross_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN NOT is_ticket THEN platform_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN NOT is_ticket THEN manager_amount ELSE 0 END), 0)
  INTO
    v_spend_ticket_gross,
    v_spend_ticket_commission,
    v_spend_ticket_manager,
    v_spend_cons_gross,
    v_spend_cons_commission,
    v_spend_cons_manager
  FROM (
    SELECT
      o.gross_amount,
      s.platform_amount,
      s.manager_amount,
      EXISTS (
        SELECT 1
        FROM public.receivables rx
        WHERE rx.payment_gateway_id = ('eventfest_credit:' || o.id::text)
           OR rx.mp_payment_id = o.id::text
      ) AS is_ticket
    FROM public.credit_spend_orders o
    INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
    WHERE o.status = 'completed'
      AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR o.created_at::date <= p_end_date)
  ) spend;

  SELECT
    COALESCE(SUM(COALESCE(r.gross_amount, r.total_amount, r.total_value, 0)), 0),
    COALESCE(SUM(fs.platform_amount), 0),
    COALESCE(SUM(
      COALESCE(
        r.net_amount_after_mp - COALESCE(r.platform_fee_amount, fs.platform_amount, 0),
        COALESCE(r.gross_amount, r.total_amount, r.total_value, 0)
          - COALESCE(r.mp_fee_amount, 0)
          - COALESCE(r.platform_fee_amount, fs.platform_amount, 0)
      )
    ), 0),
    COALESCE(SUM(COALESCE(r.mp_fee_amount, 0)), 0)
  INTO v_ticket_mp_gross, v_ticket_mp_commission, v_ticket_mp_manager, v_ticket_mp_fee
  FROM public.financial_splits fs
  INNER JOIN public.receivables r ON r.id = fs.transaction_id
  WHERE fs.platform_amount > 0
    AND r.payment_status IN ('approved', 'paid')
    AND COALESCE(r.payment_gateway_id, '') NOT LIKE 'eventfest_credit:%'
    AND COALESCE(r.settlement_channel, 'mp_split') IS DISTINCT FROM 'manual_d1'
    AND (p_start_date IS NULL OR COALESCE(r.paid_at, r.created_at)::date >= p_start_date)
    AND (p_end_date IS NULL OR COALESCE(r.paid_at, r.created_at)::date <= p_end_date);

  SELECT
    COALESCE(SUM(COALESCE(r.gross_amount, r.total_amount, r.total_value, 0)), 0),
    COALESCE(SUM(fs.platform_amount), 0),
    COALESCE(SUM(
      COALESCE(
        r.net_amount_after_mp - COALESCE(r.platform_fee_amount, fs.platform_amount, 0),
        COALESCE(r.gross_amount, r.total_amount, r.total_value, 0)
          - COALESCE(r.mp_fee_amount, 0)
          - COALESCE(r.platform_fee_amount, fs.platform_amount, 0)
      )
    ), 0),
    COALESCE(SUM(COALESCE(r.mp_fee_amount, 0)), 0)
  INTO v_ticket_d1_gross, v_ticket_d1_commission, v_ticket_d1_manager, v_ticket_d1_mp
  FROM public.financial_splits fs
  INNER JOIN public.receivables r ON r.id = fs.transaction_id
  WHERE fs.platform_amount > 0
    AND r.payment_status IN ('approved', 'paid')
    AND COALESCE(r.payment_gateway_id, '') NOT LIKE 'eventfest_credit:%'
    AND COALESCE(r.settlement_channel, '') = 'manual_d1'
    AND (p_start_date IS NULL OR COALESCE(r.paid_at, r.created_at)::date >= p_start_date)
    AND (p_end_date IS NULL OR COALESCE(r.paid_at, r.created_at)::date <= p_end_date);

  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(COALESCE(mp_fee_amount, 0)), 0)
  INTO v_listing, v_listing_mp
  FROM public.company_listing_monthly_charges
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(COALESCE(mp_fee_amount, 0)), 0)
  INTO v_license, v_license_mp
  FROM public.company_consumption_license_charges
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT COALESCE(SUM(amount), 0)
    INTO v_inactivity
  FROM public.company_ticket_inactivity_charges
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_refunds
  FROM public.credit_refund_cases
  WHERE status = 'completed'
    AND (p_start_date IS NULL OR COALESCE(completed_at, created_at)::date >= p_start_date)
    AND (p_end_date IS NULL OR COALESCE(completed_at, created_at)::date <= p_end_date);

  SELECT COALESCE(SUM(manager_amount), 0)
    INTO v_credit_remitted
  FROM public.manager_credit_settlement_ledger
  WHERE status = 'paid'
    AND paid_at IS NOT NULL
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT COALESCE(SUM(manager_amount), 0)
    INTO v_ticket_remitted
  FROM public.manager_ticket_settlement_ledger
  WHERE status = 'paid'
    AND paid_at IS NOT NULL
    AND (p_start_date IS NULL OR paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR paid_at::date <= p_end_date);

  SELECT COALESCE(SUM(manager_amount), 0)
    INTO v_credit_awaiting
  FROM public.manager_credit_settlement_ledger
  WHERE status = 'released';

  SELECT COALESCE(SUM(manager_amount), 0)
    INTO v_ticket_awaiting
  FROM public.manager_ticket_settlement_ledger
  WHERE status = 'released';

  SELECT COALESCE(SUM(manager_amount), 0)
    INTO v_credit_retention
  FROM public.manager_credit_settlement_ledger
  WHERE status = 'pending';

  SELECT COALESCE(SUM(manager_amount), 0)
    INTO v_ticket_retention
  FROM public.manager_ticket_settlement_ledger
  WHERE status = 'pending';

  v_mp_eventfest := round(v_topup_mp + v_ticket_d1_mp + v_listing_mp + v_license_mp, 2);
  v_billing_total := round(v_listing + v_license + v_inactivity, 2);
  v_ticket_commission_total := round(
    v_ticket_mp_commission + v_ticket_d1_commission + v_spend_ticket_commission,
    2
  );
  v_profit_total := round(
    v_ticket_commission_total + v_spend_cons_commission + v_billing_total,
    2
  );
  v_giro := round(v_topup_gross + v_ticket_d1_gross + v_billing_total, 2);

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'client_credits', jsonb_build_object(
      'topup_gross', round(v_topup_gross, 2),
      'topup_credit_granted', round(v_topup_granted, 2),
      'wallet_balance_now', round(v_wallet_now, 2),
      'spend_ticket_gross', round(v_spend_ticket_gross, 2),
      'spend_consumption_gross', round(v_spend_cons_gross, 2),
      'spend_gross', round(v_spend_ticket_gross + v_spend_cons_gross, 2),
      'refunds_period', round(v_refunds, 2)
    ),
    'mp_fees', jsonb_build_object(
      'topup', round(v_topup_mp, 2),
      'ticket_d1', round(v_ticket_d1_mp, 2),
      'listing_monthly', round(v_listing_mp, 2),
      'consumption_license', round(v_license_mp, 2),
      'eventfest_total', v_mp_eventfest,
      'ticket_mp_split_manager', round(v_ticket_mp_fee, 2)
    ),
    'profit', jsonb_build_object(
      'ticket_mp_split', jsonb_build_object(
        'gross', round(v_ticket_mp_gross, 2),
        'commission', round(v_ticket_mp_commission, 2),
        'manager_net', round(v_ticket_mp_manager, 2)
      ),
      'ticket_mp_d1', jsonb_build_object(
        'gross', round(v_ticket_d1_gross, 2),
        'commission', round(v_ticket_d1_commission, 2),
        'manager_net', round(v_ticket_d1_manager, 2)
      ),
      'ticket_wallet', jsonb_build_object(
        'gross', round(v_spend_ticket_gross, 2),
        'commission', round(v_spend_ticket_commission, 2),
        'manager_net', round(v_spend_ticket_manager, 2)
      ),
      'ticket_commission_total', v_ticket_commission_total,
      'consumption_wallet', jsonb_build_object(
        'gross', round(v_spend_cons_gross, 2),
        'commission', round(v_spend_cons_commission, 2),
        'manager_net', round(v_spend_cons_manager, 2)
      ),
      'listing_monthly', round(v_listing, 2),
      'consumption_license', round(v_license, 2),
      'ticket_inactivity', round(v_inactivity, 2),
      'other_billing_total', v_billing_total,
      'eventfest_profit_total', v_profit_total
    ),
    'bridge', jsonb_build_object(
      'cash_through_eventfest', v_giro,
      'eventfest_profit', v_profit_total,
      'mp_expense_eventfest', v_mp_eventfest,
      'wallet_obligation_now', round(v_wallet_now, 2),
      'remitted_to_managers_period', round(v_credit_remitted + v_ticket_remitted, 2),
      'pending_remit_now', round(v_credit_awaiting + v_ticket_awaiting, 2),
      'pending_retention', round(v_credit_retention + v_ticket_retention, 2)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_fiscal_synthetic_report(DATE, DATE) IS
  'Admin Master: sintético fiscal — giro modo banco vs lucro. pending_remit_now = só released; retenção à parte.';

-- Go-live: libera pending→released pela data, sem depender só de abrir o painel
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'settlement_release_by_release_at';

    PERFORM cron.schedule(
      'settlement_release_by_release_at',
      '*/15 * * * *',
      $job$SELECT public.process_credit_settlement_releases(); SELECT public.process_ticket_settlement_releases();$job$
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_cron indisponível; process_*_releases continua nas listagens.';
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron settlement_release_by_release_at: %', SQLERRM;
END
$cron$;
