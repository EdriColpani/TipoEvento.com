-- Contrato em eventos: só bloqueia quando a empresa precisa reaceitar o plano.
-- Empresa com plano confirmado usa o contrato já aceito (billing_contract_id), não a versão ativa global.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS contract_version TEXT;

-- Remove validações legadas de contrato (nomes variam entre ambientes).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tg.tgname
    FROM pg_trigger tg
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = 'public.events'::regclass
      AND NOT tg.tgisinternal
      AND (
        p.proname ILIKE '%event_contract%'
        OR p.proname ILIKE '%contract_version%'
        OR tg.tgname ILIKE '%contract%'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.events', r.tgname);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_event_contract_on_events ON public.events;
DROP TRIGGER IF EXISTS trg_enforce_event_contract ON public.events;
DROP TRIGGER IF EXISTS trg_validate_event_contract_on_events ON public.events;

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
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
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

  IF COALESCE(v_company.requires_billing_reacceptance, false) THEN
    RAISE EXCEPTION
      'Há uma nova versão do contrato do plano. Confirme em Perfil da Empresa → Plano e cobrança antes de criar ou atualizar eventos.';
  END IF;

  IF v_company.billing_plan IS NOT NULL
     AND v_company.billing_plan_accepted_at IS NOT NULL
     AND v_company.billing_contract_id IS NOT NULL
  THEN
    SELECT * INTO v_contract
    FROM public.event_contracts ec
    WHERE ec.id = v_company.billing_contract_id;

    IF v_contract.id IS NOT NULL THEN
      NEW.contract_id := v_contract.id;
      NEW.contract_version := v_contract.version;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.contract_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_contract
  FROM public.event_contracts ec
  WHERE ec.id = NEW.contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato do evento não encontrado.';
  END IF;

  IF NEW.contract_version IS NULL OR btrim(NEW.contract_version) = '' THEN
    NEW.contract_version := v_contract.version;
  ELSIF NEW.contract_version IS DISTINCT FROM v_contract.version THEN
    RAISE EXCEPTION
      'A versão do contrato informada (%) não corresponde ao contrato selecionado (%).',
      NEW.contract_version, v_contract.version;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_event_contract_on_events
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_contract_on_events();

REVOKE ALL ON FUNCTION public.enforce_event_contract_on_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_event_contract_on_events() TO authenticated, service_role;
