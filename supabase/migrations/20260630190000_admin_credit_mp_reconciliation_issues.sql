-- Conciliação MP por transação (visão de divergências para Admin Master)

CREATE OR REPLACE FUNCTION public.list_admin_credit_mp_reconciliation_issues(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 200,
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
  v_all JSONB;
  v_summary JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(u)::jsonb ORDER BY u.created_at DESC), '[]'::jsonb)
  INTO v_all
  FROM (
    -- Recargas pagas sem payment id MP
    SELECT
      t.created_at,
      'topup_missing_mp_payment_id'::text AS issue_type,
      'high'::text AS severity,
      'credit_topup_order'::text AS reference_type,
      t.id AS reference_id,
      t.client_user_id,
      t.origin_company_id AS company_id,
      c.corporate_name AS company_name,
      t.gross_paid_amount AS amount,
      NULL::text AS status,
      'Recarga paga sem mp_payment_id.'::text AS details
    FROM public.credit_topup_orders t
    LEFT JOIN public.companies c ON c.id = t.origin_company_id
    WHERE t.status = 'paid'
      AND (t.mp_payment_id IS NULL OR trim(t.mp_payment_id) = '')
      AND (p_start_date IS NULL OR t.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR t.created_at::date <= p_end_date)

    UNION ALL

    -- Recargas pagas sem taxa MP registrada
    SELECT
      t.created_at,
      'topup_missing_mp_fee'::text AS issue_type,
      'medium'::text AS severity,
      'credit_topup_order'::text AS reference_type,
      t.id AS reference_id,
      t.client_user_id,
      t.origin_company_id AS company_id,
      c.corporate_name AS company_name,
      t.gross_paid_amount AS amount,
      NULL::text AS status,
      'Recarga paga sem mp_fee_amount preenchido.'::text AS details
    FROM public.credit_topup_orders t
    LEFT JOIN public.companies c ON c.id = t.origin_company_id
    WHERE t.status = 'paid'
      AND t.mp_fee_amount IS NULL
      AND (p_start_date IS NULL OR t.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR t.created_at::date <= p_end_date)

    UNION ALL

    -- Spend concluído sem registro de disbursement MP
    SELECT
      o.created_at,
      'spend_missing_mp_disbursement'::text AS issue_type,
      'high'::text AS severity,
      'credit_spend_order'::text AS reference_type,
      o.id AS reference_id,
      o.client_user_id,
      o.receiver_company_id AS company_id,
      c.corporate_name AS company_name,
      o.gross_amount AS amount,
      o.status,
      'Spend concluído sem linha em credit_mp_disbursements.'::text AS details
    FROM public.credit_spend_orders o
    LEFT JOIN public.companies c ON c.id = o.receiver_company_id
    LEFT JOIN public.credit_mp_disbursements d ON d.spend_order_id = o.id
    WHERE o.status = 'completed'
      AND d.id IS NULL
      AND (p_start_date IS NULL OR o.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR o.created_at::date <= p_end_date)

    UNION ALL

    -- Disbursement pendente/processando por muito tempo
    SELECT
      d.created_at,
      'mp_disbursement_stuck_pending'::text AS issue_type,
      'medium'::text AS severity,
      'credit_mp_disbursement'::text AS reference_type,
      d.id AS reference_id,
      o.client_user_id,
      d.receiver_company_id AS company_id,
      c.corporate_name AS company_name,
      d.manager_amount AS amount,
      d.status,
      'Disbursement pendente/processando há mais de 30 minutos.'::text AS details
    FROM public.credit_mp_disbursements d
    INNER JOIN public.credit_spend_orders o ON o.id = d.spend_order_id
    LEFT JOIN public.companies c ON c.id = d.receiver_company_id
    WHERE d.status IN ('pending', 'processing')
      AND d.created_at < timezone('utc'::text, now()) - interval '30 minutes'
      AND (p_start_date IS NULL OR d.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR d.created_at::date <= p_end_date)

    UNION ALL

    -- Disbursement com falha
    SELECT
      d.created_at,
      'mp_disbursement_failed'::text AS issue_type,
      'high'::text AS severity,
      'credit_mp_disbursement'::text AS reference_type,
      d.id AS reference_id,
      o.client_user_id,
      d.receiver_company_id AS company_id,
      c.corporate_name AS company_name,
      d.manager_amount AS amount,
      d.status,
      COALESCE('Falha MP: ' || d.error_message, 'Falha MP sem detalhe.') AS details
    FROM public.credit_mp_disbursements d
    INNER JOIN public.credit_spend_orders o ON o.id = d.spend_order_id
    LEFT JOIN public.companies c ON c.id = d.receiver_company_id
    WHERE d.status = 'failed'
      AND (p_start_date IS NULL OR d.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR d.created_at::date <= p_end_date)
  ) u;

  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'created_at') DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT elem
    FROM jsonb_array_elements(v_all) elem
    OFFSET greatest(0, COALESCE(p_offset, 0))
    LIMIT greatest(1, least(COALESCE(p_limit, 200), 2000))
  ) p;

  SELECT jsonb_build_object(
    'total_issues', COALESCE(jsonb_array_length(v_all), 0),
    'high_severity', COALESCE(SUM(CASE WHEN x->>'severity' = 'high' THEN 1 ELSE 0 END), 0),
    'medium_severity', COALESCE(SUM(CASE WHEN x->>'severity' = 'medium' THEN 1 ELSE 0 END), 0),
    'topup_issues', COALESCE(SUM(CASE WHEN x->>'issue_type' LIKE 'topup_%' THEN 1 ELSE 0 END), 0),
    'spend_issues', COALESCE(SUM(CASE WHEN x->>'issue_type' LIKE 'spend_%' OR x->>'issue_type' LIKE 'mp_disbursement_%' THEN 1 ELSE 0 END), 0)
  )
  INTO v_summary
  FROM jsonb_array_elements(v_all) x;

  RETURN jsonb_build_object('items', v_rows, 'summary', v_summary);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_credit_mp_reconciliation_issues(DATE, DATE, INTEGER, INTEGER) TO authenticated;
