-- Gate obrigatório: contrato de cadastro da empresa (company_registration)
-- antes de confirmar plano e de criar/atualizar eventos.
-- "Voltar para a Home" no OTP não pode equivaler a cadastro concluído.

SELECT public.security_open_change_window('require company registration before plan and events', 20);

CREATE OR REPLACE FUNCTION public.company_has_signed_registration_contract(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contract_acceptances ca
    WHERE ca.company_id = p_company_id
      AND (
        ca.contract_type = 'company_registration'
        OR ca.acceptance_source = 'manager_register'
      )
  );
$$;

COMMENT ON FUNCTION public.company_has_signed_registration_contract(UUID) IS
  'True se a empresa assinou o contrato de cadastro (OTP em /manager/register).';

CREATE OR REPLACE FUNCTION public.company_registration_gate_satisfied(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accepted_at TIMESTAMPTZ;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.company_has_signed_registration_contract(p_company_id) THEN
    RETURN true;
  END IF;

  -- Legado: plano aceito antes de 17/08/2026 (antes deste gate).
  SELECT c.billing_plan_accepted_at
  INTO v_accepted_at
  FROM public.companies c
  WHERE c.id = p_company_id;

  RETURN v_accepted_at IS NOT NULL
     AND v_accepted_at < TIMESTAMPTZ '2026-08-17 00:00:00+00';
END;
$$;

COMMENT ON FUNCTION public.company_registration_gate_satisfied(UUID) IS
  'Cadastro da empresa ok: aceite OTP ou plano legado anterior a 2026-08-17.';

CREATE OR REPLACE FUNCTION public.enforce_registration_before_billing_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.billing_plan IS NULL OR NEW.billing_plan_accepted_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.billing_plan IS NOT DISTINCT FROM NEW.billing_plan
     AND OLD.billing_plan_accepted_at IS NOT DISTINCT FROM NEW.billing_plan_accepted_at
     AND OLD.billing_contract_id IS NOT DISTINCT FROM NEW.billing_contract_id
  THEN
    RETURN NEW;
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF NOT public.company_has_signed_registration_contract(NEW.id) THEN
    RAISE EXCEPTION
      'Assine o contrato de cadastro da empresa antes de confirmar o plano comercial.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_registration_before_billing_plan ON public.companies;
CREATE TRIGGER trg_enforce_registration_before_billing_plan
  BEFORE INSERT OR UPDATE OF billing_plan, billing_plan_accepted_at, billing_contract_id
  ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_before_billing_plan();

-- Criar evento exige plano aceito + cadastro da empresa (legado isento do OTP).
CREATE OR REPLACE FUNCTION public.enforce_event_contract_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_contract public.event_contracts%ROWTYPE;
BEGIN
  IF current_setting('app.bypass_event_contract_enforce', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.is_active IS FALSE
     AND COALESCE(OLD.is_active, false) IS DISTINCT FROM FALSE
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.time IS NOT DISTINCT FROM OLD.time
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.contract_id IS NOT DISTINCT FROM OLD.contract_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_company
  FROM public.companies c
  WHERE c.id = NEW.company_id;

  IF v_company.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.company_registration_gate_satisfied(v_company.id) THEN
    RAISE EXCEPTION
      'Assine o contrato de cadastro da empresa antes de criar ou atualizar eventos.';
  END IF;

  IF COALESCE(v_company.requires_billing_reacceptance, false) THEN
    RAISE EXCEPTION
      'Há uma nova versão do contrato do plano. Confirme em Perfil da Empresa → Plano e cobrança antes de criar ou atualizar eventos.';
  END IF;

  IF v_company.billing_plan IS NULL
     OR v_company.billing_plan_accepted_at IS NULL
     OR v_company.billing_contract_id IS NULL
  THEN
    RAISE EXCEPTION
      'Confirme o plano comercial da empresa antes de criar ou atualizar eventos.';
  END IF;

  SELECT * INTO v_contract
  FROM public.event_contracts ec
  WHERE ec.id = v_company.billing_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato do plano da empresa não encontrado.';
  END IF;

  NEW.contract_id := v_contract.id;
  NEW.contract_version := v_contract.version;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.company_has_signed_registration_contract(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_registration_gate_satisfied(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_has_signed_registration_contract(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_registration_gate_satisfied(UUID) TO authenticated;
