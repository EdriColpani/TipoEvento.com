-- Corrige timeout ao criar empresa parceira:
-- admin_create_partner_company = só INSERT empresa + histórico + convite (sem auth.users, sem licença).
-- Licença e vínculo imediato do gestor ficam para login / telas de cobrança.

CREATE OR REPLACE FUNCTION public.admin_create_partner_company(
  p_cnpj TEXT,
  p_corporate_name TEXT,
  p_trade_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_owner_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_cnpj TEXT;
  v_owner_email TEXT;
  v_invite_id UUID;
BEGIN
  PERFORM set_config('statement_timeout', '15000', true);

  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode usar esta função.';
  END IF;

  v_cnpj := regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g');
  IF length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ inválido.';
  END IF;

  IF trim(COALESCE(p_corporate_name, '')) = '' THEN
    RAISE EXCEPTION 'Informe a razão social.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.companies c WHERE c.cnpj = v_cnpj) THEN
    RAISE EXCEPTION 'CNPJ já cadastrado.';
  END IF;

  INSERT INTO public.companies (
    cnpj,
    corporate_name,
    trade_name,
    email,
    phone,
    company_kind,
    billing_plan,
    requires_billing_reacceptance
  ) VALUES (
    v_cnpj,
    trim(p_corporate_name),
    NULLIF(trim(COALESCE(p_trade_name, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), ''),
    'partner'::public.company_kind,
    'consumption_or_license'::public.billing_plan_type,
    true
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    v_company_id,
    NULL,
    'consumption_or_license'::public.billing_plan_type,
    auth.uid(),
    'admin_change'
  );

  v_owner_email := lower(trim(COALESCE(p_owner_email, p_email, '')));
  IF v_owner_email <> '' AND position('@' in v_owner_email) > 0 THEN
    INSERT INTO public.company_member_invites (company_id, email, role, invited_by)
    VALUES (v_company_id, v_owner_email, 'owner', auth.uid())
    ON CONFLICT (company_id, email) DO UPDATE
      SET role = EXCLUDED.role,
          invited_by = EXCLUDED.invited_by,
          accepted_at = NULL,
          created_at = timezone('utc'::text, now())
    RETURNING id INTO v_invite_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_company_id,
    'company_kind', 'partner',
    'billing_plan', 'consumption_or_license',
    'owner_invite', CASE
      WHEN v_invite_id IS NOT NULL THEN jsonb_build_object(
        'ok', true,
        'linked_immediately', false,
        'invite_id', v_invite_id,
        'message', 'Convite registrado. O gestor deve entrar com este e-mail para vincular a empresa.'
      )
      ELSE NULL
    END
  );
END;
$$;

-- invite_company_member: evita seq scan em auth.users quando possível
CREATE OR REPLACE FUNCTION public.invite_company_member(
  p_company_id UUID,
  p_email TEXT,
  p_role TEXT DEFAULT 'pdv_operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_role TEXT;
  v_user_id UUID;
  v_invite_id UUID;
BEGIN
  PERFORM set_config('statement_timeout', '10000', true);

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  v_email := lower(trim(COALESCE(p_email, '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Informe um e-mail válido.';
  END IF;

  v_role := COALESCE(NULLIF(trim(p_role), ''), 'pdv_operator');
  IF v_role NOT IN ('owner', 'pdv_operator') THEN
    RAISE EXCEPTION 'Papel inválido.';
  END IF;

  IF v_role = 'owner' THEN
    IF NOT public.user_is_admin_master_for_rls() THEN
      RAISE EXCEPTION 'Apenas Admin Master pode convidar dono da empresa.';
    END IF;
  ELSIF NOT public.user_owns_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para convidar membros.';
  END IF;

  SELECT u.id INTO v_user_id
  FROM auth.users u
  WHERE u.email = v_email
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    IF v_role = 'owner' THEN
      UPDATE public.profiles
      SET tipo_usuario_id = 2, natureza_juridica_id = 2
      WHERE id = v_user_id;

      IF NOT EXISTS (
        SELECT 1 FROM public.user_companies uc
        WHERE uc.user_id = v_user_id AND uc.company_id = p_company_id
      ) THEN
        INSERT INTO public.user_companies (user_id, company_id, role, is_primary)
        VALUES (v_user_id, p_company_id, 'owner', true);
      END IF;
    ELSE
      UPDATE public.profiles
      SET tipo_usuario_id = 2
      WHERE id = v_user_id;

      IF NOT EXISTS (
        SELECT 1 FROM public.user_companies uc
        WHERE uc.user_id = v_user_id AND uc.company_id = p_company_id
      ) THEN
        INSERT INTO public.user_companies (user_id, company_id, role, is_primary)
        VALUES (v_user_id, p_company_id, 'pdv_operator', false);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'linked_immediately', true,
      'user_id', v_user_id
    );
  END IF;

  INSERT INTO public.company_member_invites (company_id, email, role, invited_by)
  VALUES (p_company_id, v_email, v_role, auth.uid())
  ON CONFLICT (company_id, email) DO UPDATE
    SET role = EXCLUDED.role,
        invited_by = EXCLUDED.invited_by,
        accepted_at = NULL,
        created_at = timezone('utc'::text, now())
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'ok', true,
    'linked_immediately', false,
    'invite_id', v_invite_id,
    'message', 'Convite registrado. O usuário deve criar conta ou fazer login com este e-mail.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_partner_company(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_company_member(UUID, TEXT, TEXT) TO authenticated;

-- Admin Master: insert direto em companies (fallback do frontend)
DROP POLICY IF EXISTS companies_insert_admin_master ON public.companies;
CREATE POLICY companies_insert_admin_master
  ON public.companies
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_admin_master_for_rls());
