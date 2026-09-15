-- Admin Master cria evento em nome de um gestor (empresa + membro).
-- Ownership operacional: created_by = gestor. Billing: company_id = empresa.
SELECT public.security_open_change_window('admin create event for manager ownership', 20);

DROP POLICY IF EXISTS "events_insert_managers_and_admin" ON public.events;

CREATE POLICY "events_insert_managers_and_admin"
ON public.events
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND (
    (
      public.user_is_gestor_pro_for_rls()
      AND created_by = auth.uid()
    )
    OR (
      public.user_is_admin_master_for_rls()
      AND created_by IS NOT NULL
      AND (
        created_by = auth.uid()
        OR (
          company_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.user_companies uc
            WHERE uc.company_id = company_id
              AND uc.user_id = created_by
          )
        )
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.admin_validate_event_create_for_manager(
  p_company_id UUID,
  p_owner_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member RECORD;
  v_company RECORD;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode criar evento para gestor.';
  END IF;

  IF p_company_id IS NULL OR p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Informe a empresa e o gestor.';
  END IF;

  SELECT c.id, c.corporate_name, c.trade_name, c.billing_plan
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT
    uc.user_id,
    uc.role,
    uc.is_primary,
    trim(concat_ws(' ', NULLIF(trim(p.first_name), ''), NULLIF(trim(p.last_name), ''))) AS display_name,
    u.email
  INTO v_member
  FROM public.user_companies uc
  LEFT JOIN public.profiles p ON p.id = uc.user_id
  LEFT JOIN auth.users u ON u.id = uc.user_id
  WHERE uc.company_id = p_company_id
    AND uc.user_id = p_owner_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O gestor selecionado não pertence a esta empresa.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', v_company.id,
    'company_label', COALESCE(NULLIF(trim(v_company.trade_name), ''), NULLIF(trim(v_company.corporate_name), ''), v_company.id::text),
    'owner_user_id', v_member.user_id,
    'owner_display_name', NULLIF(trim(v_member.display_name), ''),
    'owner_email', v_member.email,
    'owner_role', v_member.role,
    'billing_plan', v_company.billing_plan
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_log_event_created_for_manager(
  p_event_id UUID,
  p_company_id UUID,
  p_owner_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  IF p_event_id IS NULL OR p_company_id IS NULL OR p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  SELECT e.id, e.created_by, e.company_id, e.is_active, e.title
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  IF v_event.company_id IS DISTINCT FROM p_company_id
     OR v_event.created_by IS DISTINCT FROM p_owner_user_id THEN
    RAISE EXCEPTION 'Evento não corresponde à empresa/gestor informados.';
  END IF;

  PERFORM public.log_admin_master_bypass(
    'create_event_for_manager',
    format('Evento "%s" criado para gestor', COALESCE(v_event.title, p_event_id::text)),
    p_company_id,
    p_event_id,
    jsonb_build_object(
      'owner_user_id', p_owner_user_id,
      'is_active', COALESCE(v_event.is_active, true),
      'created_by_admin', auth.uid()
    )
  );

  RETURN jsonb_build_object('ok', true, 'event_id', p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_validate_event_create_for_manager(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_log_event_created_for_manager(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_validate_event_create_for_manager(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_log_event_created_for_manager(UUID, UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_validate_event_create_for_manager(UUID, UUID) IS
  'Admin Master: valida empresa + gestor antes de criar evento em nome do gestor.';
COMMENT ON FUNCTION public.admin_log_event_created_for_manager(UUID, UUID, UUID) IS
  'Admin Master: audita criação de evento com created_by do gestor.';
