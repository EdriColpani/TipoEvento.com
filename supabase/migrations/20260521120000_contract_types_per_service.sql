-- Contratos por tipo de serviço (1:1 com billing_plan_type) + validação nos RPCs de plano

-- Migrar tipos legados para códigos de plano
UPDATE public.event_contracts
SET contract_type = 'ticket_commission'
WHERE contract_type = 'event_terms';

UPDATE public.event_contracts
SET contract_type = 'listing_monthly'
WHERE contract_type = 'company_membership';

UPDATE public.contract_acceptances
SET contract_type = 'ticket_commission'
WHERE contract_type = 'event_terms';

UPDATE public.contract_acceptances
SET contract_type = 'listing_monthly'
WHERE contract_type = 'company_membership';

-- Garantir contrato ativo por serviço (se só existia legado, já migrado acima)
INSERT INTO public.event_contracts (version, title, content, is_active, contract_type)
SELECT
  '1.0',
  'Contrato — % sobre venda de ingressos',
  '<p>Contrato do plano comercial de comissão sobre ingressos. Edite o conteúdo completo em Admin → Contratos.</p>',
  TRUE,
  'ticket_commission'::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_contracts WHERE contract_type = 'ticket_commission'
);

INSERT INTO public.event_contracts (version, title, content, is_active, contract_type)
SELECT
  '1.0',
  'Contrato — Mensalidade divulgação',
  '<p>Contrato do plano de divulgação (vitrine). Edite o conteúdo completo em Admin → Contratos.</p>',
  TRUE,
  'listing_monthly'::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_contracts WHERE contract_type = 'listing_monthly'
);

INSERT INTO public.event_contracts (version, title, content, is_active, contract_type)
SELECT
  '1.0',
  'Contrato — % ingresso + consumo interno',
  '<p>Contrato do plano híbrido (ingressos + consumo). Edite o conteúdo completo em Admin → Contratos.</p>',
  TRUE,
  'ticket_plus_consumption'::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_contracts WHERE contract_type = 'ticket_plus_consumption'
);

INSERT INTO public.event_contracts (version, title, content, is_active, contract_type)
SELECT
  '1.0',
  'Contrato — Consumo / licença / mensal',
  '<p>Contrato do plano de consumo ou licença. Edite o conteúdo completo em Admin → Contratos.</p>',
  TRUE,
  'consumption_or_license'::text
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_contracts WHERE contract_type = 'consumption_or_license'
);

CREATE OR REPLACE FUNCTION public.contract_type_matches_billing_plan(
  p_plan public.billing_plan_type,
  p_contract_type TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_contract_type = p_plan::text
    OR (
      p_plan = 'ticket_commission'::public.billing_plan_type
      AND p_contract_type = 'event_terms'
    )
    OR (
      p_plan = 'listing_monthly'::public.billing_plan_type
      AND p_contract_type = 'company_membership'
    );
$$;

CREATE OR REPLACE FUNCTION public.assert_billing_plan_contract_match(
  p_plan public.billing_plan_type,
  p_contract_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract RECORD;
BEGIN
  SELECT id, contract_type, is_active INTO v_contract
  FROM public.event_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  IF NOT COALESCE(v_contract.is_active, false) THEN
    RAISE EXCEPTION 'O contrato selecionado não está ativo. Ative-o em Admin → Contratos.';
  END IF;

  IF NOT public.contract_type_matches_billing_plan(p_plan, v_contract.contract_type) THEN
    RAISE EXCEPTION
      'O contrato não corresponde ao serviço/plano "%". Cadastre ou selecione o contrato do tipo correto em Admin → Contratos.',
      p_plan::text;
  END IF;
END;
$$;

-- confirm_company_billing_plan: valida contrato x plano
CREATE OR REPLACE FUNCTION public.confirm_company_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type,
  p_contract_id UUID
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
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano desta empresa.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND NOT public.billing_plan_selectable_by_gestor(p_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível. Entre em contato com o suporte.';
  END IF;

  PERFORM public.assert_billing_plan_contract_match(p_plan, p_contract_id);

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT id, version, contract_type INTO v_contract
  FROM public.event_contracts WHERE id = p_contract_id;

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
    v_contract.contract_type
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

  RETURN jsonb_build_object(
    'success', true,
    'billing_plan', p_plan,
    'change_type', v_change_type
  );
END;
$$;

-- request_company_billing_plan_upgrade
CREATE OR REPLACE FUNCTION public.request_company_billing_plan_upgrade(
  p_company_id UUID,
  p_new_plan public.billing_plan_type,
  p_contract_id UUID
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
    v_contract.contract_type
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

  RETURN jsonb_build_object('success', true, 'billing_plan', p_new_plan);
END;
$$;

-- Admin: valida contrato x plano quando informado
CREATE OR REPLACE FUNCTION public.admin_set_company_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type,
  p_contract_id UUID DEFAULT NULL
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
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode usar esta função.';
  END IF;

  IF p_contract_id IS NOT NULL THEN
    PERFORM public.assert_billing_plan_contract_match(p_plan, p_contract_id);
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF p_contract_id IS NOT NULL THEN
    SELECT id, contract_type INTO v_contract FROM public.event_contracts WHERE id = p_contract_id;
    PERFORM public._register_company_billing_acceptance(
      p_company_id,
      p_contract_id,
      v_contract.contract_type
    );
  END IF;

  IF v_company.billing_plan IS NOT NULL
     AND public.billing_plan_rank(p_plan) < public.billing_plan_rank(v_company.billing_plan) THEN
    v_change_type := 'admin_downgrade';
  ELSE
    v_change_type := 'admin_change';
  END IF;

  UPDATE public.companies
  SET
    billing_plan = p_plan,
    billing_contract_id = COALESCE(p_contract_id, billing_contract_id),
    billing_plan_accepted_at = CASE WHEN p_contract_id IS NOT NULL THEN timezone('utc'::text, now()) ELSE billing_plan_accepted_at END,
    requires_billing_reacceptance = false,
    contract_version_accepted_id = COALESCE(p_contract_id, contract_version_accepted_id)
  WHERE id = p_company_id;

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    p_plan,
    auth.uid(),
    v_change_type
  );

  RETURN jsonb_build_object('success', true, 'billing_plan', p_plan);
END;
$$;
