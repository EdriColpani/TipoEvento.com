-- Corrige jsonb_agg ORDER BY: dentro do agregado não use alias t.created_at.

CREATE OR REPLACE FUNCTION public.admin_list_master_bypass_log(p_limit INTEGER DEFAULT 100)
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
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      l.id,
      l.action_type,
      l.summary,
      l.company_id,
      l.event_id,
      l.details,
      l.created_at,
      COALESCE(
        NULLIF(trim(u.email), ''),
        NULLIF(trim(CONCAT(p.first_name, ' ', p.last_name)), '')
      ) AS actor_email,
      COALESCE(NULLIF(trim(c.trade_name), ''), c.corporate_name) AS company_name
    FROM public.admin_master_bypass_log l
    LEFT JOIN auth.users u ON u.id = l.actor_user_id
    LEFT JOIN public.profiles p ON p.id = l.actor_user_id
    LEFT JOIN public.companies c ON c.id = l.company_id
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  ) s;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_ticket_inactivity_notifications(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.created_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      n.id,
      n.company_id,
      n.reference_month,
      n.recipient_email,
      n.notification_type,
      n.payload,
      n.created_at,
      c.corporate_name AS company_name,
      c.trade_name
    FROM public.company_ticket_inactivity_notifications n
    INNER JOIN public.companies c ON c.id = n.company_id
    WHERE n.sent_at IS NULL
    ORDER BY n.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) s;

  RETURN jsonb_build_object('success', true, 'notifications', v_rows);
END;
$$;
