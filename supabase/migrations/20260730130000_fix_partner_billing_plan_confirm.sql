-- Gestor parceiro não conseguia confirmar plano consumption_or_license:
-- billing_plan_selectable_by_gestor no banco ainda limitava a listing + ticket_commission.

CREATE OR REPLACE FUNCTION public.billing_plan_selectable_by_gestor(p_plan public.billing_plan_type)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_plan IN (
    'listing_monthly'::public.billing_plan_type,
    'ticket_commission'::public.billing_plan_type,
    'ticket_plus_consumption'::public.billing_plan_type,
    'consumption_or_license'::public.billing_plan_type
  );
$$;

CREATE OR REPLACE FUNCTION public.gestor_may_select_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind public.company_kind;
BEGIN
  IF public.billing_plan_selectable_by_gestor(p_plan) THEN
    RETURN true;
  END IF;

  SELECT c.company_kind INTO v_kind
  FROM public.companies c
  WHERE c.id = p_company_id;

  RETURN v_kind = 'partner'::public.company_kind
    AND p_plan = 'consumption_or_license'::public.billing_plan_type;
END;
$$;

REVOKE ALL ON FUNCTION public.gestor_may_select_billing_plan(UUID, public.billing_plan_type) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gestor_may_select_billing_plan(UUID, public.billing_plan_type) TO authenticated;

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

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND NOT public.gestor_may_select_billing_plan(p_company_id, p_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível.';
  END IF;

  PERFORM public.assert_billing_plan_contract_match(p_plan, p_contract_id);

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

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND NOT public.gestor_may_select_billing_plan(p_company_id, p_new_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível.';
  END IF;

  PERFORM public.assert_billing_plan_contract_match(p_new_plan, p_contract_id);

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
