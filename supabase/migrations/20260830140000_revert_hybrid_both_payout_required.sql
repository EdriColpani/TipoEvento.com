-- Reverte a exigência de MP + banco juntos. Volta a regra: um modo apenas
-- (Mercado Pago OU conta bancária/PIX).

CREATE OR REPLACE FUNCTION public.company_has_valid_payout_setup(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_kind TEXT;
  v_mode TEXT;
  v_row public.company_payout_profiles%ROWTYPE;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT c.billing_plan::text, COALESCE(c.company_kind::text, 'organizer')
  INTO v_plan, v_kind
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_plan IN ('listing_monthly', 'consumption_or_license') AND v_kind <> 'partner' THEN
    RETURN true;
  END IF;

  SELECT * INTO v_row
  FROM public.company_payout_profiles p
  WHERE p.company_id = p_company_id;

  IF v_kind = 'partner' THEN
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    RETURN public.company_payout_bank_fields_complete(
      v_row.bank_code, v_row.bank_name, v_row.agency, v_row.account_number,
      v_row.holder_name, v_row.holder_document, v_row.pix_key, v_row.pix_key_type
    );
  END IF;

  IF v_plan IN ('ticket_commission', 'ticket_plus_consumption') THEN
    IF NOT FOUND THEN
      RETURN public.company_manager_has_mp_configured(p_company_id);
    END IF;
    v_mode := v_row.payout_mode;
    IF v_mode = 'mercado_pago' THEN
      RETURN public.company_manager_has_mp_configured(p_company_id);
    END IF;
    IF v_mode = 'bank_transfer' THEN
      RETURN public.company_payout_bank_fields_complete(
        v_row.bank_code, v_row.bank_name, v_row.agency, v_row.account_number,
        v_row.holder_name, v_row.holder_document, v_row.pix_key, v_row.pix_key_type
      );
    END IF;
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_company_payout_setup_for_events(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN;
  END IF;

  IF p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.billing_plan::text INTO v_plan
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_plan NOT IN ('ticket_commission', 'ticket_plus_consumption') THEN
    RETURN;
  END IF;

  IF NOT public.company_has_valid_payout_setup(p_company_id) THEN
    RAISE EXCEPTION
      'Cadastro de eventos bloqueado: configure o recebimento em Perfil da Empresa → Recebimento (Mercado Pago ou conta bancária/PIX). Caminho: /manager/settings/company-profile?tab=payments';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_payout_profile(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.company_payout_profiles%ROWTYPE;
  v_mp_ok BOOLEAN;
  v_valid BOOLEAN;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(p_company_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT * INTO v_row
  FROM public.company_payout_profiles
  WHERE company_id = p_company_id;

  v_mp_ok := public.company_manager_has_mp_configured(p_company_id);
  v_valid := public.company_has_valid_payout_setup(p_company_id);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'company_id', p_company_id,
      'exists', false,
      'payout_mode', NULL,
      'mp_configured', v_mp_ok,
      'setup_valid', v_valid,
      'bank', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'exists', true,
    'payout_mode', v_row.payout_mode,
    'mp_configured', v_mp_ok,
    'setup_valid', v_valid,
    'updated_at', v_row.updated_at,
    'bank', jsonb_build_object(
      'bank_code', v_row.bank_code,
      'bank_name', v_row.bank_name,
      'agency', v_row.agency,
      'account_number', v_row.account_number,
      'account_digit', v_row.account_digit,
      'account_type', v_row.account_type,
      'holder_name', v_row.holder_name,
      'holder_document', v_row.holder_document,
      'pix_key', v_row.pix_key,
      'pix_key_type', v_row.pix_key_type
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_company_payout_profile(
  p_company_id UUID,
  p_payout_mode TEXT,
  p_bank_code TEXT DEFAULT NULL,
  p_bank_name TEXT DEFAULT NULL,
  p_agency TEXT DEFAULT NULL,
  p_account_number TEXT DEFAULT NULL,
  p_account_digit TEXT DEFAULT NULL,
  p_account_type TEXT DEFAULT NULL,
  p_holder_name TEXT DEFAULT NULL,
  p_holder_document TEXT DEFAULT NULL,
  p_pix_key TEXT DEFAULT NULL,
  p_pix_key_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_kind TEXT;
  v_active_paid INTEGER := 0;
  v_old_mode TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(p_company_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(c.company_kind::text, 'organizer') INTO v_kind
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  v_mode := lower(trim(COALESCE(p_payout_mode, '')));
  IF v_kind = 'partner' THEN
    v_mode := 'bank_transfer';
  END IF;

  IF v_mode NOT IN ('mercado_pago', 'bank_transfer') THEN
    RAISE EXCEPTION 'Modo de recebimento inválido. Use mercado_pago ou bank_transfer.';
  END IF;

  SELECT p.payout_mode INTO v_old_mode
  FROM public.company_payout_profiles p
  WHERE p.company_id = p_company_id;

  IF v_old_mode = 'mercado_pago'
     AND v_mode = 'bank_transfer'
     AND NOT public.user_is_admin_master_for_rls() THEN
    SELECT COUNT(*)::integer INTO v_active_paid
    FROM public.events e
    WHERE e.company_id = p_company_id
      AND COALESCE(e.is_active, false) = true
      AND COALESCE(e.is_paid, false) = true;

    IF COALESCE(v_active_paid, 0) > 0 THEN
      RAISE EXCEPTION
        'Não é possível trocar para conta bancária enquanto houver eventos pagos ativos. Desative os eventos ou peça ao Admin Master.';
    END IF;
  END IF;

  IF v_mode = 'mercado_pago' THEN
    IF NOT public.company_manager_has_mp_configured(p_company_id) THEN
      RAISE EXCEPTION
        'Conecte a conta Mercado Pago em Perfil da Empresa → Recebimento antes de salvar o modo Mercado Pago.';
    END IF;
  ELSE
    IF NOT public.company_payout_bank_fields_complete(
      p_bank_code, p_bank_name, p_agency, p_account_number,
      p_holder_name, p_holder_document, p_pix_key, p_pix_key_type
    ) THEN
      RAISE EXCEPTION
        'Para receber via banco, informe banco, agência, conta, titular, documento e chave PIX.';
    END IF;
  END IF;

  INSERT INTO public.company_payout_profiles AS t (
    company_id, payout_mode, bank_code, bank_name, agency, account_number,
    account_digit, account_type, holder_name, holder_document, pix_key, pix_key_type,
    updated_at, updated_by
  ) VALUES (
    p_company_id, v_mode,
    NULLIF(trim(COALESCE(p_bank_code, '')), ''),
    NULLIF(trim(COALESCE(p_bank_name, '')), ''),
    NULLIF(trim(COALESCE(p_agency, '')), ''),
    NULLIF(trim(COALESCE(p_account_number, '')), ''),
    NULLIF(trim(COALESCE(p_account_digit, '')), ''),
    NULLIF(trim(COALESCE(p_account_type, '')), ''),
    NULLIF(trim(COALESCE(p_holder_name, '')), ''),
    NULLIF(trim(COALESCE(p_holder_document, '')), ''),
    NULLIF(trim(COALESCE(p_pix_key, '')), ''),
    NULLIF(trim(COALESCE(p_pix_key_type, '')), ''),
    timezone('utc'::text, now()),
    auth.uid()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    payout_mode = EXCLUDED.payout_mode,
    bank_code = EXCLUDED.bank_code,
    bank_name = EXCLUDED.bank_name,
    agency = EXCLUDED.agency,
    account_number = EXCLUDED.account_number,
    account_digit = EXCLUDED.account_digit,
    account_type = EXCLUDED.account_type,
    holder_name = EXCLUDED.holder_name,
    holder_document = EXCLUDED.holder_document,
    pix_key = EXCLUDED.pix_key,
    pix_key_type = EXCLUDED.pix_key_type,
    updated_at = timezone('utc'::text, now()),
    updated_by = auth.uid();

  RETURN public.get_company_payout_profile(p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_company_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type,
  p_contract_id UUID,
  p_user_agent TEXT DEFAULT NULL,
  p_accepted_ip TEXT DEFAULT NULL,
  p_scrolled_to_end BOOLEAN DEFAULT NULL,
  p_skip_contract_acceptance BOOLEAN DEFAULT false
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

  IF NOT COALESCE(p_skip_contract_acceptance, false) THEN
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
  END IF;

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
    'consumption_license', v_license,
    'skipped_contract_acceptance', COALESCE(p_skip_contract_acceptance, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_company_billing_plan_upgrade(
  p_company_id UUID,
  p_new_plan public.billing_plan_type,
  p_contract_id UUID,
  p_user_agent TEXT DEFAULT NULL,
  p_accepted_ip TEXT DEFAULT NULL,
  p_scrolled_to_end BOOLEAN DEFAULT NULL,
  p_skip_contract_acceptance BOOLEAN DEFAULT false
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

  IF NOT COALESCE(p_skip_contract_acceptance, false) THEN
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
  END IF;

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
    'consumption_license', v_license,
    'skipped_contract_acceptance', COALESCE(p_skip_contract_acceptance, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_has_valid_payout_setup(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_company_payout_setup_for_events(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_company_payout_profile(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_company_payout_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_company_billing_plan(UUID, public.billing_plan_type, UUID, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_company_billing_plan_upgrade(UUID, public.billing_plan_type, UUID, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
