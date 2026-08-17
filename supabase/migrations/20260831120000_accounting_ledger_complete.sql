-- Relatório contábil: origem/destino explícitos + ingressos MP + repasses auto/manual.

CREATE OR REPLACE FUNCTION public.accounting_client_label(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), '')
      FROM public.profiles pr
      WHERE pr.id = p_user_id
    ),
    'Cliente'
  );
$$;

CREATE OR REPLACE FUNCTION public.accounting_company_label(p_company_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT COALESCE(NULLIF(trim(c.trade_name), ''), NULLIF(trim(c.corporate_name), ''), 'Empresa')
      FROM public.companies c
      WHERE c.id = p_company_id
    ),
    'Empresa'
  );
$$;

CREATE OR REPLACE FUNCTION public.accounting_ledger_base(
  p_company_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  transaction_at TIMESTAMPTZ,
  row_kind TEXT,
  company_id UUID,
  company_name TEXT,
  origin_company_id UUID,
  origin_company_name TEXT,
  receiver_company_id UUID,
  receiver_company_name TEXT,
  client_user_id UUID,
  reference_type TEXT,
  reference_id UUID,
  spend_order_id UUID,
  gross_amount NUMERIC,
  platform_amount NUMERIC,
  manager_amount NUMERIC,
  mp_fee_amount NUMERIC,
  credit_granted_amount NUMERIC,
  net_cash_received NUMERIC,
  disbursement_status TEXT,
  mp_transfer_id TEXT,
  event_title TEXT,
  channel TEXT,
  public_description TEXT,
  is_cross_company BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 1) Recarga de crédito (cliente paga no Mercado Pago → caixa EventFest)
  SELECT
    t.paid_at,
    'topup'::text,
    COALESCE(t.origin_company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(public.accounting_company_label(t.origin_company_id), 'EventFest (sem origem de evento)'),
    t.origin_company_id,
    public.accounting_client_label(t.client_user_id) || ' (Mercado Pago)',
    NULL::uuid,
    'EventFest (caixa de crédito)'::text,
    t.client_user_id,
    'credit_topup_order'::text,
    t.id,
    NULL::uuid,
    t.gross_paid_amount,
    0::numeric,
    0::numeric,
    t.mp_fee_amount,
    t.credit_granted_amount,
    t.net_cash_received,
    'caixa_eventfest'::text,
    t.mp_payment_id,
    ev.title,
    'mercado_pago'::text,
    COALESCE(t.public_description, 'Recarga de crédito EventFest via Mercado Pago'),
    false
  FROM public.credit_topup_orders t
  LEFT JOIN public.events ev ON ev.id = t.origin_event_id
  WHERE t.status = 'paid'
    AND (p_company_id IS NULL OR t.origin_company_id = p_company_id)
    AND (p_start_date IS NULL OR t.paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR t.paid_at::date <= p_end_date)

  UNION ALL

  -- 2) Consumo / ingresso pago com crédito EventFest
  SELECT
    o.created_at,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.receivables rx
        WHERE rx.payment_gateway_id = ('eventfest_credit:' || o.id::text)
           OR rx.mp_payment_id = o.id::text
      ) THEN 'spend_ticket'
      ELSE 'spend_consumption'
    END,
    o.receiver_company_id,
    public.accounting_company_label(o.receiver_company_id),
    top.origin_company_id,
    public.accounting_client_label(o.client_user_id) || ' (crédito EventFest)',
    o.receiver_company_id,
    public.accounting_company_label(o.receiver_company_id),
    o.client_user_id,
    'credit_spend_order'::text,
    o.id,
    o.id,
    o.gross_amount,
    s.platform_amount,
    s.manager_amount,
    0::numeric,
    NULL::numeric,
    NULL::numeric,
    public.credit_settlement_disbursement_label(m.status),
    COALESCE(m.mp_payout_reference, pb.payment_reference),
    e.title,
    o.channel,
    o.public_description,
    (top.origin_company_id IS NOT NULL AND top.origin_company_id IS DISTINCT FROM o.receiver_company_id)
  FROM public.credit_spend_orders o
  INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
  LEFT JOIN public.events e ON e.id = o.receiver_event_id
  LEFT JOIN public.manager_credit_settlement_ledger m ON m.spend_order_id = o.id
  LEFT JOIN public.credit_payout_batches pb ON pb.id = m.payout_batch_id
  LEFT JOIN LATERAL (
    SELECT t2.origin_company_id
    FROM public.credit_topup_orders t2
    WHERE t2.client_user_id = o.client_user_id
      AND t2.status = 'paid'
      AND t2.paid_at <= o.created_at
    ORDER BY t2.paid_at DESC
    LIMIT 1
  ) top ON true
  WHERE o.status = 'completed'
    AND (p_company_id IS NULL OR o.receiver_company_id = p_company_id)
    AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR o.created_at::date <= p_end_date)

  UNION ALL

  -- 3) Repasse manual EventFest → gestor (crédito D+1)
  SELECT
    m.paid_at,
    'settlement_paid'::text,
    m.company_id,
    public.accounting_company_label(m.company_id),
    NULL::uuid,
    'EventFest'::text,
    m.company_id,
    public.accounting_company_label(m.company_id) || ' (PIX/TED)',
    o.client_user_id,
    'credit_settlement'::text,
    m.id,
    m.spend_order_id,
    m.manager_amount,
    0::numeric,
    m.manager_amount,
    NULL::numeric,
    NULL::numeric,
    NULL::numeric,
    'paid_manual'::text,
    COALESCE(m.mp_payout_reference, pb.payment_reference),
    e.title,
    COALESCE(pb.payment_method, 'pix'),
    format(
      'Repasse manual %s — ref. %s',
      upper(COALESCE(pb.payment_method, 'pix')),
      COALESCE(pb.payment_reference, m.mp_payout_reference, '—')
    ),
    false
  FROM public.manager_credit_settlement_ledger m
  INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
  LEFT JOIN public.events e ON e.id = o.receiver_event_id
  LEFT JOIN public.credit_payout_batches pb ON pb.id = m.payout_batch_id
  WHERE m.status = 'paid'
    AND m.paid_at IS NOT NULL
    AND (p_company_id IS NULL OR m.company_id = p_company_id)
    AND (p_start_date IS NULL OR m.paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR m.paid_at::date <= p_end_date)

  UNION ALL

  -- 4) Estorno de crédito
  SELECT
    COALESCE(r.completed_at, r.created_at),
    'refund'::text,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'EventFest (estorno)'::text,
    NULL::uuid,
    'EventFest'::text,
    NULL::uuid,
    public.accounting_client_label(r.client_user_id) || ' (carteira)',
    r.client_user_id,
    'credit_refund_case'::text,
    r.id,
    NULL::uuid,
    (-r.refund_amount)::numeric,
    0::numeric,
    0::numeric,
    NULL::numeric,
    (-r.refund_amount)::numeric,
    NULL::numeric,
    r.status,
    NULL::text,
    NULL::text,
    'estorno'::text,
    r.public_description,
    false
  FROM public.credit_refund_cases r
  WHERE r.status = 'completed'
    AND p_company_id IS NULL
    AND (p_start_date IS NULL OR COALESCE(r.completed_at, r.created_at)::date >= p_start_date)
    AND (p_end_date IS NULL OR COALESCE(r.completed_at, r.created_at)::date <= p_end_date)

  UNION ALL

  -- 5) Compra de ingresso via Mercado Pago (não crédito)
  SELECT
    COALESCE(r.paid_at, r.created_at),
    CASE
      WHEN COALESCE(r.settlement_channel, 'mp_split') = 'manual_d1' THEN 'ticket_sale_d1'
      ELSE 'ticket_sale_mp'
    END,
    e.company_id,
    public.accounting_company_label(e.company_id),
    NULL::uuid,
    public.accounting_client_label(r.client_user_id) || ' (Mercado Pago)',
    e.company_id,
    CASE
      WHEN COALESCE(r.settlement_channel, 'mp_split') = 'manual_d1'
        THEN 'EventFest (caixa ingresso)'
      ELSE public.accounting_company_label(e.company_id) || ' (conta Mercado Pago)'
    END,
    r.client_user_id,
    'receivable'::text,
    r.id,
    NULL::uuid,
    COALESCE(r.gross_amount, r.total_amount, r.total_value, 0),
    COALESCE(r.platform_fee_amount, 0),
    COALESCE(
      r.net_amount_after_mp - COALESCE(r.platform_fee_amount, 0),
      COALESCE(r.gross_amount, r.total_amount, r.total_value, 0)
        - COALESCE(r.mp_fee_amount, 0)
        - COALESCE(r.platform_fee_amount, 0)
    ),
    COALESCE(r.mp_fee_amount, 0),
    NULL::numeric,
    COALESCE(r.net_amount_after_mp, 0),
    CASE
      WHEN COALESCE(r.settlement_channel, 'mp_split') = 'manual_d1' THEN 'caixa_eventfest_d1'
      ELSE 'mp_split_automatico'
    END,
    r.mp_payment_id,
    e.title,
    COALESCE(r.settlement_channel, 'mp_split'),
    CASE
      WHEN COALESCE(r.settlement_channel, 'mp_split') = 'manual_d1'
        THEN 'Ingresso cobrado na conta Mercado Pago da EventFest (repasse D+1)'
      ELSE 'Ingresso com split automático na conta Mercado Pago do gestor'
    END,
    false
  FROM public.receivables r
  INNER JOIN public.events e ON e.id = r.event_id
  WHERE r.payment_status IN ('approved', 'paid')
    AND COALESCE(r.payment_gateway_id, '') NOT LIKE 'eventfest_credit:%'
    AND (p_company_id IS NULL OR e.company_id = p_company_id)
    AND (p_start_date IS NULL OR COALESCE(r.paid_at, r.created_at)::date >= p_start_date)
    AND (p_end_date IS NULL OR COALESCE(r.paid_at, r.created_at)::date <= p_end_date)

  UNION ALL

  -- 6) Repasse manual EventFest → gestor (ingresso D+1)
  SELECT
    ts.paid_at,
    'ticket_settlement_paid'::text,
    ts.company_id,
    public.accounting_company_label(ts.company_id),
    NULL::uuid,
    'EventFest'::text,
    ts.company_id,
    public.accounting_company_label(ts.company_id) || ' (PIX/TED)',
    rec.client_user_id,
    'ticket_settlement'::text,
    ts.id,
    NULL::uuid,
    ts.manager_amount,
    0::numeric,
    ts.manager_amount,
    NULL::numeric,
    NULL::numeric,
    NULL::numeric,
    'paid_manual'::text,
    COALESCE(ts.payment_reference, pb.payment_reference),
    e.title,
    COALESCE(pb.payment_method, 'pix'),
    format(
      'Repasse manual ingresso %s — ref. %s',
      upper(COALESCE(pb.payment_method, 'pix')),
      COALESCE(ts.payment_reference, pb.payment_reference, '—')
    ),
    false
  FROM public.manager_ticket_settlement_ledger ts
  LEFT JOIN public.receivables rec ON rec.id = ts.receivable_id
  LEFT JOIN public.events e ON e.id = ts.event_id
  LEFT JOIN public.credit_payout_batches pb ON pb.id = ts.payout_batch_id
  WHERE ts.status = 'paid'
    AND ts.paid_at IS NOT NULL
    AND (p_company_id IS NULL OR ts.company_id = p_company_id)
    AND (p_start_date IS NULL OR ts.paid_at::date >= p_start_date)
    AND (p_end_date IS NULL OR ts.paid_at::date <= p_end_date);
$$;

REVOKE ALL ON FUNCTION public.accounting_client_label(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accounting_company_label(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accounting_ledger_base(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_client_label(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_company_label(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_ledger_base(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.list_admin_credit_accounting_report(
  p_company_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 500,
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
  v_summary JSONB;
  v_all JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(u)::jsonb ORDER BY u.transaction_at DESC), '[]'::jsonb)
  INTO v_all
  FROM public.accounting_ledger_base(p_company_id, p_start_date, p_end_date) u;

  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'transaction_at') DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT elem
    FROM jsonb_array_elements(v_all) elem
    OFFSET greatest(0, COALESCE(p_offset, 0))
    LIMIT greatest(1, least(COALESCE(p_limit, 500), 5000))
  ) p;

  SELECT jsonb_build_object(
    'topup_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN 1 ELSE 0 END), 0),
    'topup_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'topup_mp_fees', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('topup', 'ticket_sale_mp', 'ticket_sale_d1') THEN COALESCE((x->>'mp_fee_amount')::numeric, 0) ELSE 0 END), 0),
    'topup_credit_granted', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN COALESCE((x->>'credit_granted_amount')::numeric, 0) ELSE 0 END), 0),
    'spend_count', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption') THEN 1 ELSE 0 END), 0),
    'spend_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption') THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'platform_commission', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption', 'ticket_sale_mp', 'ticket_sale_d1') THEN COALESCE((x->>'platform_amount')::numeric, 0) ELSE 0 END), 0),
    'manager_net', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption', 'ticket_sale_mp', 'ticket_sale_d1') THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
    'ticket_sale_count', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('ticket_sale_mp', 'ticket_sale_d1') THEN 1 ELSE 0 END), 0),
    'ticket_sale_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('ticket_sale_mp', 'ticket_sale_d1') THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'settlement_paid_count', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('settlement_paid', 'ticket_settlement_paid') THEN 1 ELSE 0 END), 0),
    'settlement_paid_total', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('settlement_paid', 'ticket_settlement_paid') THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
    'refund_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'refund' THEN 1 ELSE 0 END), 0),
    'refund_total', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'refund' THEN ABS((x->>'gross_amount')::numeric) ELSE 0 END), 0),
    'cross_spend_count', COALESCE(SUM(CASE WHEN (x->>'is_cross_company')::boolean THEN 1 ELSE 0 END), 0),
    'total_rows', COALESCE(jsonb_array_length(v_all), 0)
  )
  INTO v_summary
  FROM jsonb_array_elements(v_all) x;

  RETURN jsonb_build_object('items', v_rows, 'summary', v_summary);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manager_credit_accounting_report(
  p_company_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 500,
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
  v_summary JSONB;
  v_all JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Informe a empresa.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(u)::jsonb ORDER BY u.transaction_at DESC), '[]'::jsonb)
  INTO v_all
  FROM public.accounting_ledger_base(p_company_id, p_start_date, p_end_date) u;

  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'transaction_at') DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT elem
    FROM jsonb_array_elements(v_all) elem
    OFFSET greatest(0, COALESCE(p_offset, 0))
    LIMIT greatest(1, least(COALESCE(p_limit, 500), 5000))
  ) p;

  SELECT jsonb_build_object(
    'topup_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN 1 ELSE 0 END), 0),
    'topup_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'topup_mp_fees', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('topup', 'ticket_sale_mp', 'ticket_sale_d1') THEN COALESCE((x->>'mp_fee_amount')::numeric, 0) ELSE 0 END), 0),
    'topup_credit_granted', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN COALESCE((x->>'credit_granted_amount')::numeric, 0) ELSE 0 END), 0),
    'spend_count', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption') THEN 1 ELSE 0 END), 0),
    'spend_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption') THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'platform_commission', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption', 'ticket_sale_mp', 'ticket_sale_d1') THEN COALESCE((x->>'platform_amount')::numeric, 0) ELSE 0 END), 0),
    'manager_net', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'spend_ticket', 'spend_consumption', 'ticket_sale_mp', 'ticket_sale_d1') THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
    'ticket_sale_count', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('ticket_sale_mp', 'ticket_sale_d1') THEN 1 ELSE 0 END), 0),
    'ticket_sale_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('ticket_sale_mp', 'ticket_sale_d1') THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'settlement_paid_count', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('settlement_paid', 'ticket_settlement_paid') THEN 1 ELSE 0 END), 0),
    'settlement_paid_total', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('settlement_paid', 'ticket_settlement_paid') THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
    'cross_spend_count', COALESCE(SUM(CASE WHEN (x->>'is_cross_company')::boolean THEN 1 ELSE 0 END), 0),
    'total_rows', COALESCE(jsonb_array_length(v_all), 0)
  )
  INTO v_summary
  FROM jsonb_array_elements(v_all) x;

  RETURN jsonb_build_object('items', v_rows, 'summary', v_summary);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_credit_accounting_report(UUID, DATE, DATE, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manager_credit_accounting_report(UUID, DATE, DATE, INTEGER, INTEGER) TO authenticated;

