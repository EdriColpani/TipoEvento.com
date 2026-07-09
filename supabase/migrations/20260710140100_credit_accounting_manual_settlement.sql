-- Relatório contábil: repasse manual D+1 (substitui credit_mp_disbursements)

CREATE OR REPLACE FUNCTION public.credit_settlement_disbursement_label(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'pending' THEN 'pending_d1'
    WHEN 'released' THEN 'awaiting_manual_payment'
    WHEN 'paid' THEN 'paid_manual'
    WHEN 'clawback' THEN 'clawback'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE p_status
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
  FROM (
    SELECT *
    FROM (
      SELECT
        t.paid_at AS transaction_at,
        'topup_origin'::text AS row_kind,
        t.origin_company_id AS company_id,
        oc.corporate_name AS company_name,
        t.origin_company_id,
        oc.corporate_name AS origin_company_name,
        NULL::uuid AS receiver_company_id,
        NULL::text AS receiver_company_name,
        t.client_user_id,
        'credit_topup_order'::text AS reference_type,
        t.id AS reference_id,
        NULL::uuid AS spend_order_id,
        t.gross_paid_amount AS gross_amount,
        0::numeric(14, 2) AS platform_amount,
        0::numeric(14, 2) AS manager_amount,
        t.mp_fee_amount,
        t.credit_granted_amount,
        t.net_cash_received,
        NULL::text AS disbursement_status,
        t.mp_payment_id AS mp_transfer_id,
        NULL::text AS event_title,
        NULL::text AS channel,
        t.public_description,
        false AS is_cross_company
      FROM public.credit_topup_orders t
      LEFT JOIN public.companies oc ON oc.id = t.origin_company_id
      WHERE t.status = 'paid'
        AND t.origin_company_id = p_company_id
        AND (p_start_date IS NULL OR t.paid_at::date >= p_start_date)
        AND (p_end_date IS NULL OR t.paid_at::date <= p_end_date)

      UNION ALL

      SELECT
        o.created_at AS transaction_at,
        'spend_received'::text AS row_kind,
        o.receiver_company_id AS company_id,
        rc.corporate_name AS company_name,
        top.origin_company_id,
        oc.corporate_name AS origin_company_name,
        o.receiver_company_id,
        rc.corporate_name AS receiver_company_name,
        o.client_user_id,
        'credit_spend_order'::text AS reference_type,
        o.id AS reference_id,
        o.id AS spend_order_id,
        o.gross_amount AS gross_amount,
        s.platform_amount,
        s.manager_amount,
        NULL::numeric(14, 2) AS mp_fee_amount,
        NULL::numeric(14, 2) AS credit_granted_amount,
        NULL::numeric(14, 2) AS net_cash_received,
        public.credit_settlement_disbursement_label(m.status) AS disbursement_status,
        COALESCE(m.mp_payout_reference, pb.payment_reference) AS mp_transfer_id,
        e.title AS event_title,
        o.channel,
        o.public_description,
        (top.origin_company_id IS NOT NULL AND top.origin_company_id IS DISTINCT FROM o.receiver_company_id) AS is_cross_company
      FROM public.credit_spend_orders o
      INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
      INNER JOIN public.companies rc ON rc.id = o.receiver_company_id
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
      LEFT JOIN public.companies oc ON oc.id = top.origin_company_id
      WHERE o.status = 'completed'
        AND o.receiver_company_id = p_company_id
        AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
        AND (p_end_date IS NULL OR o.created_at::date <= p_end_date)

      UNION ALL

      SELECT
        m.paid_at AS transaction_at,
        'settlement_paid'::text AS row_kind,
        m.company_id AS company_id,
        rc.corporate_name AS company_name,
        NULL::uuid AS origin_company_id,
        NULL::text AS origin_company_name,
        m.company_id AS receiver_company_id,
        rc.corporate_name AS receiver_company_name,
        o.client_user_id,
        'credit_settlement'::text AS reference_type,
        m.id AS reference_id,
        m.spend_order_id,
        m.manager_amount AS gross_amount,
        0::numeric(14, 2) AS platform_amount,
        m.manager_amount AS manager_amount,
        NULL::numeric(14, 2) AS mp_fee_amount,
        NULL::numeric(14, 2) AS credit_granted_amount,
        NULL::numeric(14, 2) AS net_cash_received,
        'paid_manual'::text AS disbursement_status,
        COALESCE(m.mp_payout_reference, pb.payment_reference) AS mp_transfer_id,
        e.title AS event_title,
        o.channel,
        format(
          'Liquidação manual %s — ref. %s',
          upper(COALESCE(pb.payment_method, 'pix')),
          COALESCE(pb.payment_reference, m.mp_payout_reference, '—')
        ) AS public_description,
        false AS is_cross_company
      FROM public.manager_credit_settlement_ledger m
      INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
      INNER JOIN public.companies rc ON rc.id = m.company_id
      LEFT JOIN public.events e ON e.id = o.receiver_event_id
      LEFT JOIN public.credit_payout_batches pb ON pb.id = m.payout_batch_id
      WHERE m.status = 'paid'
        AND m.paid_at IS NOT NULL
        AND m.company_id = p_company_id
        AND (p_start_date IS NULL OR m.paid_at::date >= p_start_date)
        AND (p_end_date IS NULL OR m.paid_at::date <= p_end_date)
    ) u
  ) u;

  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'transaction_at') DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT elem
    FROM jsonb_array_elements(v_all) elem
    OFFSET greatest(0, COALESCE(p_offset, 0))
    LIMIT greatest(1, least(COALESCE(p_limit, 500), 5000))
  ) p;

  SELECT jsonb_build_object(
    'topup_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup_origin' THEN 1 ELSE 0 END), 0),
    'topup_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup_origin' THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'topup_mp_fees', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup_origin' THEN COALESCE((x->>'mp_fee_amount')::numeric, 0) ELSE 0 END), 0),
    'topup_credit_granted', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup_origin' THEN COALESCE((x->>'credit_granted_amount')::numeric, 0) ELSE 0 END), 0),
    'spend_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'spend_received' THEN 1 ELSE 0 END), 0),
    'spend_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'spend_received' THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'platform_commission', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'spend_received' THEN COALESCE((x->>'platform_amount')::numeric, 0) ELSE 0 END), 0),
    'manager_net', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend_received', 'settlement_paid') THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
    'settlement_paid_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'settlement_paid' THEN 1 ELSE 0 END), 0),
    'settlement_paid_total', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'settlement_paid' THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
    'cross_spend_count', COALESCE(SUM(CASE WHEN (x->>'is_cross_company')::boolean THEN 1 ELSE 0 END), 0),
    'total_rows', COALESCE(jsonb_array_length(v_all), 0)
  )
  INTO v_summary
  FROM jsonb_array_elements(v_all) x;

  RETURN jsonb_build_object('items', v_rows, 'summary', v_summary);
END;
$$;

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
  FROM (
    SELECT *
    FROM (
      SELECT
        t.paid_at AS transaction_at,
        'topup'::text AS row_kind,
        COALESCE(t.origin_company_id, '00000000-0000-0000-0000-000000000000'::uuid) AS company_id,
        COALESCE(oc.corporate_name, 'EventFest (sem origem)') AS company_name,
        t.origin_company_id,
        oc.corporate_name AS origin_company_name,
        NULL::uuid AS receiver_company_id,
        NULL::text AS receiver_company_name,
        t.client_user_id,
        'credit_topup_order'::text AS reference_type,
        t.id AS reference_id,
        NULL::uuid AS spend_order_id,
        t.gross_paid_amount AS gross_amount,
        0::numeric(14, 2) AS platform_amount,
        0::numeric(14, 2) AS manager_amount,
        t.mp_fee_amount,
        t.credit_granted_amount,
        t.net_cash_received,
        NULL::text AS disbursement_status,
        t.mp_payment_id AS mp_transfer_id,
        ev.title AS event_title,
        NULL::text AS channel,
        t.public_description,
        false AS is_cross_company
      FROM public.credit_topup_orders t
      LEFT JOIN public.companies oc ON oc.id = t.origin_company_id
      LEFT JOIN public.events ev ON ev.id = t.origin_event_id
      WHERE t.status = 'paid'
        AND (p_company_id IS NULL OR t.origin_company_id = p_company_id)
        AND (p_start_date IS NULL OR t.paid_at::date >= p_start_date)
        AND (p_end_date IS NULL OR t.paid_at::date <= p_end_date)

      UNION ALL

      SELECT
        o.created_at AS transaction_at,
        'spend'::text AS row_kind,
        o.receiver_company_id AS company_id,
        rc.corporate_name AS company_name,
        top.origin_company_id,
        oc.corporate_name AS origin_company_name,
        o.receiver_company_id,
        rc.corporate_name AS receiver_company_name,
        o.client_user_id,
        'credit_spend_order'::text AS reference_type,
        o.id AS reference_id,
        o.id AS spend_order_id,
        o.gross_amount AS gross_amount,
        s.platform_amount,
        s.manager_amount,
        NULL::numeric(14, 2) AS mp_fee_amount,
        NULL::numeric(14, 2) AS credit_granted_amount,
        NULL::numeric(14, 2) AS net_cash_received,
        public.credit_settlement_disbursement_label(m.status) AS disbursement_status,
        COALESCE(m.mp_payout_reference, pb.payment_reference) AS mp_transfer_id,
        e.title AS event_title,
        o.channel,
        o.public_description,
        (top.origin_company_id IS NOT NULL AND top.origin_company_id IS DISTINCT FROM o.receiver_company_id) AS is_cross_company
      FROM public.credit_spend_orders o
      INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
      INNER JOIN public.companies rc ON rc.id = o.receiver_company_id
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
      LEFT JOIN public.companies oc ON oc.id = top.origin_company_id
      WHERE o.status = 'completed'
        AND (p_company_id IS NULL OR o.receiver_company_id = p_company_id)
        AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
        AND (p_end_date IS NULL OR o.created_at::date <= p_end_date)

      UNION ALL

      SELECT
        m.paid_at AS transaction_at,
        'settlement_paid'::text AS row_kind,
        m.company_id AS company_id,
        rc.corporate_name AS company_name,
        NULL::uuid AS origin_company_id,
        NULL::text AS origin_company_name,
        m.company_id AS receiver_company_id,
        rc.corporate_name AS receiver_company_name,
        o.client_user_id,
        'credit_settlement'::text AS reference_type,
        m.id AS reference_id,
        m.spend_order_id,
        m.manager_amount AS gross_amount,
        0::numeric(14, 2) AS platform_amount,
        m.manager_amount AS manager_amount,
        NULL::numeric(14, 2) AS mp_fee_amount,
        NULL::numeric(14, 2) AS credit_granted_amount,
        NULL::numeric(14, 2) AS net_cash_received,
        'paid_manual'::text AS disbursement_status,
        COALESCE(m.mp_payout_reference, pb.payment_reference) AS mp_transfer_id,
        e.title AS event_title,
        o.channel,
        format(
          'Liquidação manual %s — ref. %s',
          upper(COALESCE(pb.payment_method, 'pix')),
          COALESCE(pb.payment_reference, m.mp_payout_reference, '—')
        ) AS public_description,
        false AS is_cross_company
      FROM public.manager_credit_settlement_ledger m
      INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
      INNER JOIN public.companies rc ON rc.id = m.company_id
      LEFT JOIN public.events e ON e.id = o.receiver_event_id
      LEFT JOIN public.credit_payout_batches pb ON pb.id = m.payout_batch_id
      WHERE m.status = 'paid'
        AND m.paid_at IS NOT NULL
        AND (p_company_id IS NULL OR m.company_id = p_company_id)
        AND (p_start_date IS NULL OR m.paid_at::date >= p_start_date)
        AND (p_end_date IS NULL OR m.paid_at::date <= p_end_date)

      UNION ALL

      SELECT
        COALESCE(r.completed_at, r.created_at) AS transaction_at,
        'refund'::text AS row_kind,
        '00000000-0000-0000-0000-000000000000'::uuid AS company_id,
        'EventFest (estorno)' AS company_name,
        NULL::uuid AS origin_company_id,
        NULL::text AS origin_company_name,
        NULL::uuid AS receiver_company_id,
        NULL::text AS receiver_company_name,
        r.client_user_id,
        'credit_refund_case'::text AS reference_type,
        r.id AS reference_id,
        NULL::uuid AS spend_order_id,
        (-r.refund_amount)::numeric(14, 2) AS gross_amount,
        0::numeric(14, 2) AS platform_amount,
        0::numeric(14, 2) AS manager_amount,
        NULL::numeric(14, 2) AS mp_fee_amount,
        (-r.refund_amount)::numeric(14, 2) AS credit_granted_amount,
        NULL::numeric(14, 2) AS net_cash_received,
        r.status AS disbursement_status,
        NULL::text AS mp_transfer_id,
        NULL::text AS event_title,
        NULL::text AS channel,
        r.public_description,
        false AS is_cross_company
      FROM public.credit_refund_cases r
      WHERE r.status = 'completed'
        AND p_company_id IS NULL
        AND (p_start_date IS NULL OR COALESCE(r.completed_at, r.created_at)::date >= p_start_date)
        AND (p_end_date IS NULL OR COALESCE(r.completed_at, r.created_at)::date <= p_end_date)
    ) u
  ) u;

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
    'topup_mp_fees', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN COALESCE((x->>'mp_fee_amount')::numeric, 0) ELSE 0 END), 0),
    'topup_credit_granted', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'topup' THEN COALESCE((x->>'credit_granted_amount')::numeric, 0) ELSE 0 END), 0),
    'spend_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'spend' THEN 1 ELSE 0 END), 0),
    'spend_gross', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'spend' THEN (x->>'gross_amount')::numeric ELSE 0 END), 0),
    'platform_commission', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'spend' THEN COALESCE((x->>'platform_amount')::numeric, 0) ELSE 0 END), 0),
    'manager_net', COALESCE(SUM(CASE WHEN x->>'row_kind' IN ('spend', 'settlement_paid') THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
    'settlement_paid_count', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'settlement_paid' THEN 1 ELSE 0 END), 0),
    'settlement_paid_total', COALESCE(SUM(CASE WHEN x->>'row_kind' = 'settlement_paid' THEN COALESCE((x->>'manager_amount')::numeric, 0) ELSE 0 END), 0),
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
