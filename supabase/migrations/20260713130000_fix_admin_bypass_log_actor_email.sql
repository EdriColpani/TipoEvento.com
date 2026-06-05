-- Corrige log de bypass (profiles não tem email) e reexpõe RPC.

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

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
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
  ) t;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;
