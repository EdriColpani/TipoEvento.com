-- Empresas parceiras (consumo), operadores PDV e convites de membros

DO $$ BEGIN
  CREATE TYPE public.company_kind AS ENUM ('organizer', 'partner');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_kind public.company_kind NOT NULL DEFAULT 'organizer';

COMMENT ON COLUMN public.companies.company_kind IS
  'organizer = produtor de eventos; partner = estabelecimento parceiro (consumo/créditos).';

-- Papel na empresa (antes de políticas RLS que referenciam uc.role)
ALTER TABLE public.user_companies
  ADD COLUMN IF NOT EXISTS role TEXT;

UPDATE public.user_companies
SET role = 'owner'
WHERE role IS NULL OR trim(role) = '';

ALTER TABLE public.user_companies
  ALTER COLUMN role SET DEFAULT 'owner';

ALTER TABLE public.user_companies
  ALTER COLUMN role SET NOT NULL;

COMMENT ON COLUMN public.user_companies.role IS
  'owner = proprietário; pdv_operator = operador PDV (catálogo + balcão, sem gestão da empresa).';

ALTER TABLE public.user_companies
  DROP CONSTRAINT IF EXISTS user_companies_role_check;

ALTER TABLE public.user_companies
  ADD CONSTRAINT user_companies_role_check
  CHECK (role IN ('owner', 'pdv_operator'));

-- Convites pendentes (dono ou operador PDV)
CREATE TABLE IF NOT EXISTS public.company_member_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'pdv_operator'
    CHECK (role IN ('owner', 'pdv_operator')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT company_member_invites_email_lower CHECK (email = lower(trim(email))),
  CONSTRAINT company_member_invites_company_email_uidx UNIQUE (company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_company_member_invites_email_pending
  ON public.company_member_invites (lower(email))
  WHERE accepted_at IS NULL;

ALTER TABLE public.company_member_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_member_invites_admin_all ON public.company_member_invites;
CREATE POLICY company_member_invites_admin_all
  ON public.company_member_invites
  FOR ALL
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS company_member_invites_owner_select ON public.company_member_invites;
CREATE POLICY company_member_invites_owner_select
  ON public.company_member_invites
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_member_invites.company_id
        AND uc.user_id = auth.uid()
        AND COALESCE(uc.role, 'owner') = 'owner'
    )
  );

-- Helpers de permissão
CREATE OR REPLACE FUNCTION public.user_company_role(
  p_company_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT uc.role
      FROM public.user_companies uc
      WHERE uc.company_id = p_company_id
        AND uc.user_id = p_user_id
      LIMIT 1
    ),
    NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.user_owns_company(
  p_company_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = p_company_id
        AND uc.user_id = p_user_id
        AND COALESCE(uc.role, 'owner') = 'owner'
    );
$$;

CREATE OR REPLACE FUNCTION public.user_operates_credit_pdv(
  p_company_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = p_company_id
        AND uc.user_id = p_user_id
        AND COALESCE(uc.role, 'owner') IN ('owner', 'pdv_operator')
    );
$$;

-- Gestão de catálogo: dono, operador PDV ou admin
CREATE OR REPLACE FUNCTION public.user_manages_credit_company(
  p_company_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_operates_credit_pdv(p_company_id, p_user_id);
$$;

-- Estabelecimentos (estrutura): somente dono ou admin
CREATE OR REPLACE FUNCTION public.user_manages_credit_establishments(
  p_company_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_owns_company(p_company_id, p_user_id);
$$;

-- Ajuste de features do plano consumo (somente vitrine + créditos)
-- Opcional: tabela vem de 20260523120000_billing_plan_features.sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'billing_plan_features'
  ) THEN
    UPDATE public.billing_plan_features
    SET enabled = false, updated_at = timezone('utc'::text, now())
    WHERE billing_plan = 'consumption_or_license'::public.billing_plan_type
      AND feature_key IN (
        'wristbands',
        'validation_keys',
        'reports_financial',
        'reports_sales',
        'reports_wristband_movements',
        'reports_audience'
      );
  END IF;
END $$;

-- save_credit_establishment: exige dono
CREATE OR REPLACE FUNCTION public.save_credit_establishment(
  p_company_id UUID,
  p_name TEXT,
  p_event_id UUID DEFAULT NULL,
  p_establishment_id UUID DEFAULT NULL,
  p_credit_acceptance_enabled BOOLEAN DEFAULT true,
  p_active BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_establishments(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar estabelecimentos.';
  END IF;

  IF NOT public.credit_module_globally_enabled() THEN
    RAISE EXCEPTION 'Módulo de créditos EventFest indisponível.';
  END IF;

  IF NOT public.company_allows_credit_consumption(p_company_id) THEN
    RAISE EXCEPTION 'Plano comercial da empresa não habilita consumo por crédito.';
  END IF;

  v_name := trim(COALESCE(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome do estabelecimento.';
  END IF;

  IF p_event_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = p_event_id AND e.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Evento inválido para esta empresa.';
    END IF;
  END IF;

  IF p_establishment_id IS NOT NULL THEN
    UPDATE public.credit_establishments ce
    SET
      name = v_name,
      event_id = p_event_id,
      credit_acceptance_enabled = COALESCE(p_credit_acceptance_enabled, true),
      active = COALESCE(p_active, true)
    WHERE ce.id = p_establishment_id
      AND ce.company_id = p_company_id
    RETURNING ce.id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Estabelecimento não encontrado.';
    END IF;
  ELSE
    INSERT INTO public.credit_establishments (
      company_id,
      event_id,
      name,
      credit_acceptance_enabled,
      active
    ) VALUES (
      p_company_id,
      p_event_id,
      v_name,
      COALESCE(p_credit_acceptance_enabled, true),
      COALESCE(p_active, true)
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'establishment_id', v_id);
END;
$$;

-- Assinatura (uuid,uuid,boolean) existia com ordem invertida em 20260623120000; DROP obrigatório.
DROP FUNCTION IF EXISTS public.set_credit_establishment_active(UUID, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.set_credit_establishment_active(
  p_company_id UUID,
  p_establishment_id UUID,
  p_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_manages_credit_establishments(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar estabelecimentos.';
  END IF;

  UPDATE public.credit_establishments
  SET active = COALESCE(p_active, false)
  WHERE id = p_establishment_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estabelecimento não encontrado.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'active', COALESCE(p_active, false));
END;
$$;

-- Aceitar convites pendentes pelo e-mail do usuário logado
CREATE OR REPLACE FUNCTION public.accept_company_member_invites()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_invite RECORD;
  v_accepted INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT u.id, lower(u.email) AS email
  INTO v_user
  FROM auth.users u
  WHERE u.id = auth.uid();

  IF v_user.email IS NULL OR v_user.email = '' THEN
    RETURN jsonb_build_object('accepted', 0);
  END IF;

  FOR v_invite IN
    SELECT i.*
    FROM public.company_member_invites i
    WHERE lower(i.email) = v_user.email
      AND i.accepted_at IS NULL
    ORDER BY i.created_at ASC
  LOOP
    IF v_invite.role = 'owner' THEN
      UPDATE public.profiles p
      SET tipo_usuario_id = 2, natureza_juridica_id = 2
      WHERE p.id = auth.uid()
        AND COALESCE(p.tipo_usuario_id, 3) = 3;

      IF NOT EXISTS (
        SELECT 1 FROM public.user_companies uc
        WHERE uc.user_id = auth.uid() AND uc.company_id = v_invite.company_id
      ) THEN
        INSERT INTO public.user_companies (user_id, company_id, role, is_primary)
        VALUES (auth.uid(), v_invite.company_id, 'owner', true);
      END IF;
    ELSE
      UPDATE public.profiles p
      SET tipo_usuario_id = 2
      WHERE p.id = auth.uid()
        AND COALESCE(p.tipo_usuario_id, 3) = 3;

      IF NOT EXISTS (
        SELECT 1 FROM public.user_companies uc
        WHERE uc.user_id = auth.uid() AND uc.company_id = v_invite.company_id
      ) THEN
        INSERT INTO public.user_companies (user_id, company_id, role, is_primary)
        VALUES (auth.uid(), v_invite.company_id, 'pdv_operator', false);
      END IF;
    END IF;

    UPDATE public.company_member_invites
    SET accepted_at = timezone('utc'::text, now())
    WHERE id = v_invite.id;

    v_accepted := v_accepted + 1;
  END LOOP;

  RETURN jsonb_build_object('accepted', v_accepted);
END;
$$;

-- Convidar operador PDV (dono) ou dono (admin)
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
  WHERE lower(u.email) = v_email
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

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.role, t.email), '[]'::jsonb)
  INTO v_members
  FROM (
    SELECT
      uc.user_id,
      uc.role,
      uc.is_primary,
      p.email,
      COALESCE(p.name, p.email, uc.user_id::text) AS display_name
    FROM public.user_companies uc
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

-- Admin Master: criar empresa parceira
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
  v_invite JSONB;
  v_license JSONB;
BEGIN
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

  v_license := public.ensure_consumption_license_charge(v_company_id);

  v_owner_email := lower(trim(COALESCE(p_owner_email, p_email, '')));
  v_invite := NULL;
  IF v_owner_email <> '' AND position('@' in v_owner_email) > 0 THEN
    v_invite := public.invite_company_member(v_company_id, v_owner_email, 'owner');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_company_id,
    'company_kind', 'partner',
    'billing_plan', 'consumption_or_license',
    'consumption_license', v_license,
    'owner_invite', v_invite
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_credit_establishment(UUID, TEXT, UUID, UUID, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_credit_establishment_active(UUID, UUID, BOOLEAN) TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_company_role(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_company(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_operates_credit_pdv(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_manages_credit_establishments(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_company_member_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_company_member(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_company_members(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_partner_company(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
