-- Enriquecer listas admin/gestor com recovery_mode e dados de cobrança

CREATE OR REPLACE FUNCTION public.list_admin_ticket_chargebacks(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_open_debt_only BOOLEAN DEFAULT FALSE,
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
    RAISE EXCEPTION 'Sem permissao.';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_total
  FROM public.ticket_chargeback_cases c
  LEFT JOIN public.manager_ticket_chargeback_debt d ON d.chargeback_case_id = c.id
  WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
    AND (
      NOT COALESCE(p_open_debt_only, false)
      OR (d.status IN ('open', 'partial') AND (d.amount_due - d.amount_applied) > 0)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.receivable_id,
      c.event_id,
      c.company_id,
      c.client_user_id,
      c.manager_user_id,
      c.mp_payment_id,
      c.mp_status,
      c.gross_amount,
      c.platform_fee_amount,
      c.manager_net_amount,
      c.tickets_cancelled_count,
      c.already_checked_in,
      c.needs_manual_review,
      c.reason,
      c.created_at,
      c.manager_notified_at,
      c.admin_notified_at,
      e.title AS event_title,
      co.corporate_name AS company_name,
      co.billing_plan::text AS billing_plan,
      d.id AS debt_id,
      d.status AS debt_status,
      d.recovery_mode,
      d.amount_due AS debt_amount_due,
      d.amount_applied AS debt_amount_applied,
      round(COALESCE(d.amount_due, 0) - COALESCE(d.amount_applied, 0), 2) AS debt_remaining,
      d.payment_reference AS debt_payment_reference,
      ('EF-TCB-' || upper(substr(replace(d.id::text, '-', ''), 1, 10))) AS payment_ref_hint
    FROM public.ticket_chargeback_cases c
    LEFT JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    LEFT JOIN public.manager_ticket_chargeback_debt d ON d.chargeback_case_id = c.id
    WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
      AND (
        NOT COALESCE(p_open_debt_only, false)
        OR (d.status IN ('open', 'partial') AND (d.amount_due - d.amount_applied) > 0)
      )
    ORDER BY c.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manager_ticket_chargeback_debts(
  p_company_id UUID DEFAULT NULL
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
  IF p_company_id IS NOT NULL THEN
    IF NOT (
      public.user_is_admin_master_for_rls()
      OR public.user_owns_company(p_company_id, auth.uid())
    ) THEN
      RAISE EXCEPTION 'Sem permissao.';
    END IF;
  ELSIF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Informe a empresa.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      d.id,
      d.chargeback_case_id,
      d.company_id,
      d.amount_due,
      d.amount_applied,
      round(d.amount_due - d.amount_applied, 2) AS amount_remaining,
      d.status,
      d.recovery_mode,
      d.payment_method,
      d.payment_reference,
      d.created_at,
      c.mp_payment_id,
      c.event_id,
      e.title AS event_title,
      c.manager_net_amount,
      c.reason,
      ('EF-TCB-' || upper(substr(replace(d.id::text, '-', ''), 1, 10))) AS payment_ref_hint
    FROM public.manager_ticket_chargeback_debt d
    INNER JOIN public.ticket_chargeback_cases c ON c.id = d.chargeback_case_id
    LEFT JOIN public.events e ON e.id = c.event_id
    WHERE (p_company_id IS NULL OR d.company_id = p_company_id)
      AND (
        public.user_is_admin_master_for_rls()
        OR public.user_owns_company(d.company_id, auth.uid())
      )
    ORDER BY d.created_at DESC
    LIMIT 200
  ) t;

  RETURN jsonb_build_object('items', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_ticket_chargeback_notifications(
  p_limit INTEGER DEFAULT 50,
  p_chargeback_case_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.receivable_id,
      c.event_id,
      c.company_id,
      c.client_user_id,
      c.manager_user_id,
      c.mp_payment_id,
      c.mp_status,
      c.gross_amount,
      c.platform_fee_amount,
      c.manager_net_amount,
      c.tickets_cancelled_count,
      c.already_checked_in,
      c.needs_manual_review,
      c.reason,
      c.created_at,
      c.manager_notified_at,
      c.admin_notified_at,
      e.title AS event_title,
      co.corporate_name AS company_name,
      co.email AS company_email,
      co.billing_plan::text AS billing_plan,
      mu.email AS manager_email,
      cu.email AS client_email,
      d.id AS debt_id,
      d.recovery_mode,
      ('EF-TCB-' || upper(substr(replace(COALESCE(d.id::text, c.id::text), '-', ''), 1, 10))) AS payment_ref_hint
    FROM public.ticket_chargeback_cases c
    LEFT JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    LEFT JOIN public.manager_ticket_chargeback_debt d ON d.chargeback_case_id = c.id
    LEFT JOIN auth.users mu ON mu.id = c.manager_user_id
    LEFT JOIN auth.users cu ON cu.id = c.client_user_id
    WHERE (p_chargeback_case_id IS NULL OR c.id = p_chargeback_case_id)
      AND (c.manager_notified_at IS NULL OR c.admin_notified_at IS NULL)
    ORDER BY c.created_at ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 100))
  ) t;

  RETURN jsonb_build_object('items', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_ticket_chargebacks(DATE, DATE, BOOLEAN, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manager_ticket_chargeback_debts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_ticket_chargeback_notifications(INTEGER, UUID) TO service_role;
