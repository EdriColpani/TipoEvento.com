-- E-mail do gestor: auth.users (profiles não tem email).

CREATE OR REPLACE FUNCTION public.list_company_members(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_members JSONB;
  v_invites JSONB;
BEGIN
  IF NOT public.user_owns_company(p_company_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.is_primary DESC, t.role, t.email), '[]'::jsonb)
  INTO v_members
  FROM (
    SELECT
      uc.user_id,
      uc.role,
      uc.is_primary,
      u.email,
      trim(concat_ws(' ', p.first_name, p.last_name)) AS display_name
    FROM public.user_companies uc
    LEFT JOIN auth.users u ON u.id = uc.user_id
    LEFT JOIN public.profiles p ON p.id = uc.user_id
    WHERE uc.company_id = p_company_id
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_invites
  FROM (
    SELECT id, email, role, created_at
    FROM public.company_member_invites
    WHERE company_id = p_company_id
      AND accepted_at IS NULL
  ) t;

  RETURN jsonb_build_object('members', v_members, 'pending_invites', v_invites);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_companies_billing()
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
    RAISE EXCEPTION 'Apenas Admin Master pode acessar esta lista.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.corporate_name NULLS LAST, t.trade_name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.corporate_name,
      c.trade_name,
      c.cnpj,
      c.email,
      c.company_kind,
      c.billing_plan,
      c.billing_plan_accepted_at,
      c.billing_contract_id,
      c.billing_plan_locked_until,
      c.requires_billing_reacceptance,
      c.listing_monthly_fee,
      c.consumption_license_fee,
      c.min_event_tickets,
      c.min_event_tickets_customized,
      c.ticket_inactivity_blocked,
      c.created_at,
      COALESCE(
        mgr.member_email,
        invite.owner_invite_email,
        NULLIF(trim(c.email), '')
      ) AS manager_email
    FROM public.companies c
    LEFT JOIN LATERAL (
      SELECT u.email AS member_email
      FROM public.user_companies uc
      INNER JOIN auth.users u ON u.id = uc.user_id
      WHERE uc.company_id = c.id
      ORDER BY uc.is_primary DESC, CASE uc.role WHEN 'owner' THEN 0 ELSE 1 END, uc.user_id
      LIMIT 1
    ) mgr ON TRUE
    LEFT JOIN LATERAL (
      SELECT i.email AS owner_invite_email
      FROM public.company_member_invites i
      WHERE i.company_id = c.id
        AND i.role = 'owner'
        AND i.accepted_at IS NULL
      ORDER BY i.created_at DESC
      LIMIT 1
    ) invite ON TRUE
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_companies_billing() TO authenticated;
