-- Auditoria reforçada de aceite de contratos + relatório admin por empresa

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.contract_acceptances
  ADD COLUMN IF NOT EXISTS contract_title_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS content_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS acceptance_source TEXT,
  ADD COLUMN IF NOT EXISTS accepted_ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS scrolled_to_end BOOLEAN,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_company_type
  ON public.contract_acceptances(company_id, contract_type, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_accepted_at
  ON public.contract_acceptances(accepted_at DESC);

CREATE OR REPLACE FUNCTION public.compute_contract_content_hash(p_content TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(COALESCE(p_content, ''), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.register_contract_acceptance(
  p_contract_id UUID,
  p_contract_type TEXT,
  p_company_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_acceptance_source TEXT DEFAULT 'web',
  p_user_agent TEXT DEFAULT NULL,
  p_accepted_ip TEXT DEFAULT NULL,
  p_scrolled_to_end BOOLEAN DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_contract public.event_contracts%ROWTYPE;
  v_target_user UUID;
  v_hash TEXT;
  v_acceptance_id UUID;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  v_actor := COALESCE(p_user_id, auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_contract_id IS NULL OR p_contract_type IS NULL OR trim(p_contract_type) = '' THEN
    RAISE EXCEPTION 'Contrato inválido para aceite.';
  END IF;

  IF p_company_id IS NOT NULL THEN
    IF NOT (
      public.user_is_admin_master_for_rls()
      OR public.user_can_manage_company_billing(p_company_id)
      OR EXISTS (
        SELECT 1 FROM public.user_companies uc
        WHERE uc.company_id = p_company_id AND uc.user_id = v_actor
      )
    ) THEN
      RAISE EXCEPTION 'Sem permissão para registrar aceite desta empresa.';
    END IF;
  ELSIF v_actor IS DISTINCT FROM auth.uid() AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão para registrar aceite de outro usuário.';
  END IF;

  SELECT * INTO v_contract
  FROM public.event_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  IF v_contract.contract_type IS DISTINCT FROM trim(p_contract_type) THEN
    RAISE EXCEPTION 'Tipo de contrato não corresponde ao contrato informado.';
  END IF;

  v_hash := public.compute_contract_content_hash(v_contract.content);
  v_target_user := v_actor;

  IF p_company_id IS NOT NULL THEN
    DELETE FROM public.contract_acceptances
    WHERE company_id = p_company_id
      AND contract_type = trim(p_contract_type);

    INSERT INTO public.contract_acceptances (
      user_id,
      company_id,
      contract_id,
      contract_version,
      contract_type,
      accepted_at,
      contract_title_snapshot,
      content_snapshot,
      content_hash,
      acceptance_source,
      accepted_ip,
      user_agent,
      scrolled_to_end,
      metadata
    ) VALUES (
      v_target_user,
      p_company_id,
      v_contract.id,
      v_contract.version,
      v_contract.contract_type,
      v_now,
      v_contract.title,
      v_contract.content,
      v_hash,
      NULLIF(trim(p_acceptance_source), ''),
      NULLIF(trim(p_accepted_ip), ''),
      NULLIF(left(trim(COALESCE(p_user_agent, '')), 2000), ''),
      p_scrolled_to_end,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_acceptance_id;
  ELSE
    INSERT INTO public.contract_acceptances (
      user_id,
      company_id,
      contract_id,
      contract_version,
      contract_type,
      accepted_at,
      contract_title_snapshot,
      content_snapshot,
      content_hash,
      acceptance_source,
      accepted_ip,
      user_agent,
      scrolled_to_end,
      metadata
    ) VALUES (
      v_target_user,
      NULL,
      v_contract.id,
      v_contract.version,
      v_contract.contract_type,
      v_now,
      v_contract.title,
      v_contract.content,
      v_hash,
      NULLIF(trim(p_acceptance_source), ''),
      NULLIF(trim(p_accepted_ip), ''),
      NULLIF(left(trim(COALESCE(p_user_agent, '')), 2000), ''),
      p_scrolled_to_end,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    ON CONFLICT (user_id, contract_type) WHERE user_id IS NOT NULL
    DO UPDATE SET
      contract_id = EXCLUDED.contract_id,
      contract_version = EXCLUDED.contract_version,
      accepted_at = v_now,
      contract_title_snapshot = EXCLUDED.contract_title_snapshot,
      content_snapshot = EXCLUDED.content_snapshot,
      content_hash = EXCLUDED.content_hash,
      acceptance_source = EXCLUDED.acceptance_source,
      accepted_ip = EXCLUDED.accepted_ip,
      user_agent = EXCLUDED.user_agent,
      scrolled_to_end = EXCLUDED.scrolled_to_end,
      metadata = EXCLUDED.metadata
    RETURNING id INTO v_acceptance_id;
  END IF;

  IF trim(p_contract_type) = 'client_terms' THEN
    UPDATE public.profiles
    SET contract_version_accepted_id = v_contract.id
    WHERE id = v_target_user;
  END IF;

  IF p_company_id IS NOT NULL THEN
    UPDATE public.companies
    SET contract_version_accepted_id = v_contract.id
    WHERE id = p_company_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'acceptance_id', v_acceptance_id,
    'contract_id', v_contract.id,
    'contract_version', v_contract.version,
    'content_hash', v_hash,
    'accepted_at', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._register_company_billing_acceptance(
  p_company_id UUID,
  p_contract_id UUID,
  p_contract_type TEXT,
  p_acceptance_source TEXT DEFAULT 'billing',
  p_user_agent TEXT DEFAULT NULL,
  p_accepted_ip TEXT DEFAULT NULL,
  p_scrolled_to_end BOOLEAN DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.register_contract_acceptance(
    p_contract_id,
    p_contract_type,
    p_company_id,
    auth.uid(),
    COALESCE(NULLIF(trim(p_acceptance_source), ''), 'billing'),
    p_user_agent,
    p_accepted_ip,
    p_scrolled_to_end,
    p_metadata
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_company_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type,
  p_contract_id UUID,
  p_user_agent TEXT DEFAULT NULL,
  p_accepted_ip TEXT DEFAULT NULL,
  p_scrolled_to_end BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_contract RECORD;
  v_change_type TEXT;
  v_license JSONB;
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano desta empresa.';
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
  ELSIF NOT public.billing_plan_selectable_by_gestor(p_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível.';
  END IF;

  PERFORM public.assert_billing_plan_contract_match(p_plan, p_contract_id);

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT id, contract_type INTO v_contract FROM public.event_contracts WHERE id = p_contract_id;

  IF NOT public.user_is_admin_master_for_rls()
     AND v_company.billing_plan IS NOT NULL
     AND v_company.billing_plan IS DISTINCT FROM p_plan
     AND public.billing_plan_rank(p_plan) > public.billing_plan_rank(v_company.billing_plan) THEN
    RAISE EXCEPTION 'Para mudar para um plano superior, use a opção de upgrade no perfil da empresa.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND v_company.billing_plan IS NOT NULL
     AND v_company.billing_plan IS DISTINCT FROM p_plan
     AND public.billing_plan_rank(p_plan) < public.billing_plan_rank(v_company.billing_plan) THEN
    RAISE EXCEPTION 'Downgrade de plano só pode ser feito pelo administrador do sistema.';
  END IF;

  IF v_company.billing_plan IS NULL THEN
    v_change_type := 'initial';
  ELSIF v_company.requires_billing_reacceptance
        OR v_company.billing_contract_id IS DISTINCT FROM p_contract_id THEN
    v_change_type := 'reacceptance';
  ELSE
    v_change_type := 'reacceptance';
  END IF;

  UPDATE public.companies
  SET
    billing_plan = p_plan,
    billing_contract_id = p_contract_id,
    billing_plan_accepted_at = timezone('utc'::text, now()),
    requires_billing_reacceptance = false,
    contract_version_accepted_id = p_contract_id
  WHERE id = p_company_id;

  PERFORM public._register_company_billing_acceptance(
    p_company_id,
    p_contract_id,
    v_contract.contract_type,
    'billing',
    p_user_agent,
    p_accepted_ip,
    p_scrolled_to_end,
    jsonb_build_object('billing_plan', p_plan::text, 'change_type', v_change_type)
  );

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    p_plan,
    auth.uid(),
    v_change_type
  );

  v_license := NULL;
  IF p_plan = 'consumption_or_license'::public.billing_plan_type THEN
    v_license := public.ensure_consumption_license_charge(p_company_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'billing_plan', p_plan,
    'change_type', v_change_type,
    'consumption_license', v_license
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_company_billing_plan_upgrade(
  p_company_id UUID,
  p_new_plan public.billing_plan_type,
  p_contract_id UUID,
  p_user_agent TEXT DEFAULT NULL,
  p_accepted_ip TEXT DEFAULT NULL,
  p_scrolled_to_end BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_contract RECORD;
  v_cooldown_days CONSTANT INTEGER := 90;
  v_license JSONB;
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano desta empresa.';
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
  ELSIF NOT public.billing_plan_selectable_by_gestor(p_new_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível.';
  END IF;

  PERFORM public.assert_billing_plan_contract_match(p_new_plan, p_contract_id);

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF v_company.billing_plan IS NULL THEN
    RAISE EXCEPTION 'Confirme primeiro o plano atual antes de fazer upgrade.';
  END IF;

  IF public.billing_plan_rank(p_new_plan) <= public.billing_plan_rank(v_company.billing_plan) THEN
    RAISE EXCEPTION 'Apenas upgrade para plano superior é permitido. Para reduzir o plano, contate o administrador.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND v_company.billing_plan_locked_until IS NOT NULL
     AND v_company.billing_plan_locked_until > timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'Upgrade disponível após %', to_char(v_company.billing_plan_locked_until, 'DD/MM/YYYY');
  END IF;

  SELECT id, contract_type INTO v_contract FROM public.event_contracts WHERE id = p_contract_id;

  UPDATE public.companies
  SET
    billing_plan = p_new_plan,
    billing_contract_id = p_contract_id,
    billing_plan_accepted_at = timezone('utc'::text, now()),
    requires_billing_reacceptance = false,
    contract_version_accepted_id = p_contract_id,
    billing_plan_locked_until = CASE
      WHEN public.user_is_admin_master_for_rls() THEN billing_plan_locked_until
      ELSE timezone('utc'::text, now()) + (v_cooldown_days || ' days')::interval
    END
  WHERE id = p_company_id;

  PERFORM public._register_company_billing_acceptance(
    p_company_id,
    p_contract_id,
    v_contract.contract_type,
    'billing_upgrade',
    p_user_agent,
    p_accepted_ip,
    p_scrolled_to_end,
    jsonb_build_object('billing_plan', p_new_plan::text, 'change_type', 'upgrade')
  );

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    p_new_plan,
    auth.uid(),
    'upgrade'
  );

  v_license := NULL;
  IF p_new_plan = 'consumption_or_license'::public.billing_plan_type THEN
    v_license := public.ensure_consumption_license_charge(p_company_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'billing_plan', p_new_plan,
    'consumption_license', v_license
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_contract_acceptance_companies(
  p_search TEXT DEFAULT NULL
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
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.company_name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT DISTINCT
      c.id AS company_id,
      COALESCE(NULLIF(trim(c.trade_name), ''), c.corporate_name, c.id::text) AS company_name,
      c.corporate_name,
      c.billing_plan::text AS billing_plan
    FROM public.companies c
    WHERE (
      p_search IS NULL OR trim(p_search) = ''
      OR c.corporate_name ILIKE '%' || trim(p_search) || '%'
      OR c.trade_name ILIKE '%' || trim(p_search) || '%'
      OR c.cnpj ILIKE '%' || trim(p_search) || '%'
    )
    ORDER BY company_name
    LIMIT 500
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_company_contract_acceptances(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company JSONB;
  v_items JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa não informada.';
  END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'corporate_name', c.corporate_name,
    'trade_name', c.trade_name,
    'cnpj', c.cnpj,
    'billing_plan', c.billing_plan::text,
    'billing_plan_accepted_at', c.billing_plan_accepted_at,
    'billing_contract_id', c.billing_contract_id,
    'contract_version_accepted_id', c.contract_version_accepted_id,
    'requires_billing_reacceptance', c.requires_billing_reacceptance
  )
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.accepted_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ca.id,
      ca.user_id,
      u.email AS user_email,
      trim(concat_ws(' ', p.first_name, p.last_name)) AS user_name,
      ca.company_id,
      ca.contract_id,
      ca.contract_version,
      ca.contract_type,
      ca.accepted_at,
      ca.contract_title_snapshot,
      ca.content_hash,
      ca.acceptance_source,
      ca.accepted_ip,
      ca.user_agent,
      ca.scrolled_to_end,
      ca.metadata,
      ec.version AS current_contract_version,
      ec.is_active AS current_contract_is_active,
      length(COALESCE(ca.content_snapshot, '')) AS content_snapshot_length,
      ca.content_snapshot
    FROM public.contract_acceptances ca
    LEFT JOIN auth.users u ON u.id = ca.user_id
    LEFT JOIN public.profiles p ON p.id = ca.user_id
    LEFT JOIN public.event_contracts ec ON ec.id = ca.contract_id
    WHERE ca.company_id = p_company_id
       OR (
         ca.user_id IN (
           SELECT uc.user_id FROM public.user_companies uc WHERE uc.company_id = p_company_id
         )
       )
    ORDER BY ca.accepted_at DESC
  ) t;

  RETURN jsonb_build_object(
    'company', v_company,
    'items', v_items,
    'total', COALESCE(jsonb_array_length(v_items), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_contract_acceptance(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_contract_acceptance_companies(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_company_contract_acceptances(UUID) TO authenticated;
