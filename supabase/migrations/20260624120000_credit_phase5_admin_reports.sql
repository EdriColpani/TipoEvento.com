-- Fase 5: relatórios admin (passivo, comissões, cross-empresa, auditoria) + credit_audit_log

CREATE TABLE IF NOT EXISTS public.credit_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id UUID,
  reference_type TEXT,
  reference_id UUID,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_credit_audit_log_created
  ON public.credit_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_audit_log_reference
  ON public.credit_audit_log(reference_type, reference_id);

ALTER TABLE public.credit_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_audit_log_admin ON public.credit_audit_log;
CREATE POLICY credit_audit_log_admin
  ON public.credit_audit_log FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

CREATE OR REPLACE FUNCTION public.credit_audit_log_from_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.credit_audit_log (
    event_type,
    subject_user_id,
    company_id,
    reference_type,
    reference_id,
    summary,
    payload
  ) VALUES (
    COALESCE(NEW.entry_subtype, NEW.entry_type),
    NEW.account_user_id,
    COALESCE(NEW.receiver_company_id, NEW.origin_company_id),
    NEW.reference_type,
    NEW.reference_id,
    NEW.public_description,
    jsonb_build_object(
      'amount', NEW.amount,
      'balance_after', NEW.balance_after,
      'entry_type', NEW.entry_type,
      'metadata', NEW.metadata,
      'internal_description', NEW.internal_description
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_audit_log_from_ledger ON public.credit_ledger_entries;
CREATE TRIGGER trg_credit_audit_log_from_ledger
  AFTER INSERT ON public.credit_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_audit_log_from_ledger();

INSERT INTO public.credit_audit_log (
  event_type,
  subject_user_id,
  company_id,
  reference_type,
  reference_id,
  summary,
  payload,
  created_at
)
SELECT
  COALESCE(e.entry_subtype, e.entry_type),
  e.account_user_id,
  COALESCE(e.receiver_company_id, e.origin_company_id),
  e.reference_type,
  e.reference_id,
  e.public_description,
  jsonb_build_object(
    'amount', e.amount,
    'balance_after', e.balance_after,
    'entry_type', e.entry_type,
    'metadata', e.metadata,
    'backfill', true
  ),
  e.created_at
FROM public.credit_ledger_entries e
WHERE NOT EXISTS (
  SELECT 1 FROM public.credit_audit_log a
  WHERE a.reference_type = e.reference_type
    AND a.reference_id = e.reference_id
    AND a.event_type = COALESCE(e.entry_subtype, e.entry_type)
);

CREATE OR REPLACE FUNCTION public.get_admin_credit_liability_reconciliation()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_liability NUMERIC(14, 2);
  v_ledger_net NUMERIC(14, 2);
  v_wallets NUMERIC(14, 2);
  v_topup_credit NUMERIC(14, 2);
  v_topup_mp_fees NUMERIC(14, 2);
  v_topup_net_cash NUMERIC(14, 2);
  v_spend_gross NUMERIC(14, 2);
  v_commission NUMERIC(14, 2);
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(outstanding_amount, 0)
  INTO v_liability
  FROM public.platform_credit_liability
  WHERE id = 1;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_ledger_net
  FROM public.credit_ledger_entries;

  SELECT COALESCE(SUM(balance_cached), 0)
  INTO v_wallets
  FROM public.client_credit_accounts;

  SELECT
    COALESCE(SUM(credit_granted_amount), 0),
    COALESCE(SUM(mp_fee_amount), 0),
    COALESCE(SUM(net_cash_received), 0)
  INTO v_topup_credit, v_topup_mp_fees, v_topup_net_cash
  FROM public.credit_topup_orders
  WHERE status = 'paid';

  SELECT COALESCE(SUM(gross_amount), 0)
  INTO v_spend_gross
  FROM public.credit_spend_orders
  WHERE status = 'completed';

  SELECT COALESCE(SUM(platform_amount), 0)
  INTO v_commission
  FROM public.credit_financial_splits;

  RETURN jsonb_build_object(
    'module_enabled', public.credit_module_globally_enabled(),
    'liability_cached', v_liability,
    'liability_from_ledger', round(v_ledger_net, 2),
    'total_wallet_balances', round(v_wallets, 2),
    'topup_credit_granted', round(v_topup_credit, 2),
    'topup_mp_fees', round(v_topup_mp_fees, 2),
    'topup_net_cash', round(v_topup_net_cash, 2),
    'spend_gross_total', round(v_spend_gross, 2),
    'platform_commission_total', round(v_commission, 2),
    'liability_matches_ledger', abs(v_liability - v_ledger_net) < 0.02,
    'liability_matches_wallets', abs(v_liability - v_wallets) < 0.02,
    'expected_liability_from_topups', round(v_topup_credit - v_spend_gross, 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_commission_report(
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
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
  v_rows JSONB;
  v_summary JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.spend_gross DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id AS company_id,
      c.corporate_name AS company_name,
      COUNT(DISTINCT o.id)::integer AS spend_count,
      COALESCE(SUM(o.gross_amount), 0)::numeric(14, 2) AS spend_gross,
      COALESCE(SUM(s.platform_amount), 0)::numeric(14, 2) AS platform_commission,
      COALESCE(SUM(s.manager_amount), 0)::numeric(14, 2) AS manager_net
    FROM public.credit_spend_orders o
    INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
    INNER JOIN public.companies c ON c.id = o.receiver_company_id
    WHERE o.status = 'completed'
      AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR o.created_at::date <= p_end_date)
    GROUP BY c.id, c.corporate_name
    ORDER BY spend_gross DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  SELECT jsonb_build_object(
    'spend_count', COALESCE(SUM((x->>'spend_count')::integer), 0),
    'spend_gross', COALESCE(SUM((x->>'spend_gross')::numeric), 0),
    'platform_commission', COALESCE(SUM((x->>'platform_commission')::numeric), 0),
    'manager_net', COALESCE(SUM((x->>'manager_net')::numeric), 0)
  )
  INTO v_summary
  FROM jsonb_array_elements(v_rows) x;

  RETURN jsonb_build_object('items', v_rows, 'summary', v_summary);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_cross_company_flows(
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

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.spend_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      o.id AS spend_order_id,
      o.client_user_id,
      o.gross_amount AS spend_amount,
      o.created_at AS spend_at,
      rc.id AS receiver_company_id,
      rc.corporate_name AS receiver_company_name,
      oc.id AS origin_company_id,
      oc.corporate_name AS origin_company_name,
      t.id AS topup_order_id,
      t.credit_granted_amount AS topup_credit_amount,
      t.paid_at AS topup_paid_at
    FROM public.credit_spend_orders o
    INNER JOIN public.companies rc ON rc.id = o.receiver_company_id
    INNER JOIN LATERAL (
      SELECT t2.*
      FROM public.credit_topup_orders t2
      WHERE t2.client_user_id = o.client_user_id
        AND t2.status = 'paid'
        AND t2.origin_company_id IS NOT NULL
        AND t2.paid_at <= o.created_at
      ORDER BY t2.paid_at DESC
      LIMIT 1
    ) t ON true
    LEFT JOIN public.companies oc ON oc.id = t.origin_company_id
    WHERE o.status = 'completed'
      AND t.origin_company_id IS DISTINCT FROM o.receiver_company_id
    ORDER BY o.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_audit_log(
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
      a.id,
      a.event_type,
      a.subject_user_id,
      a.company_id,
      c.corporate_name AS company_name,
      a.reference_type,
      a.reference_id,
      a.summary,
      a.payload,
      a.created_at
    FROM public.credit_audit_log a
    LEFT JOIN public.companies c ON c.id = a.company_id
    ORDER BY a.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_credit_liability_reconciliation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_credit_commission_report(INTEGER, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_credit_cross_company_flows(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_credit_audit_log(INTEGER, INTEGER) TO authenticated;
