-- Fase 4b: reforço de permissões por plano nas APIs (triggers + mensagens)

CREATE OR REPLACE FUNCTION public.plan_feature_label(p_feature_key TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_feature_key
    WHEN 'dashboard' THEN 'Dashboard PRO'
    WHEN 'events' THEN 'Eventos'
    WHEN 'events_create' THEN 'Criar evento'
    WHEN 'events_banners' THEN 'Banners de evento'
    WHEN 'wristbands' THEN 'Ingressos'
    WHEN 'validation_keys' THEN 'Chaves de validação'
    WHEN 'reports' THEN 'Relatórios'
    WHEN 'reports_financial' THEN 'Relatório financeiro'
    WHEN 'reports_sales' THEN 'Relatório de vendas'
    WHEN 'reports_events' THEN 'Relatório de eventos'
    WHEN 'reports_audience' THEN 'Relatório de público'
    WHEN 'reports_registrations' THEN 'Relatório de inscrições'
    WHEN 'reports_wristband_movements' THEN 'Movimentação de ingressos'
    WHEN 'reports_listing_monthly' THEN 'Mensalidade de divulgação'
    WHEN 'settings' THEN 'Configurações'
    ELSE p_feature_key
  END;
$$;

-- Verifica feature pelo plano da empresa (sem depender de auth.uid — uso em triggers/edge).
CREATE OR REPLACE FUNCTION public.company_plan_feature_enabled(
  p_company_id UUID,
  p_feature_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_ready BOOLEAN;
  v_map JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    c.billing_plan,
    (
      c.billing_plan IS NOT NULL
      AND NOT COALESCE(c.requires_billing_reacceptance, false)
      AND c.billing_plan_accepted_at IS NOT NULL
      AND c.billing_contract_id IS NOT NULL
    )
  INTO v_plan, v_ready
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND OR v_plan IS NULL OR NOT v_ready THEN
    RETURN false;
  END IF;

  v_map := public._billing_plan_features_map(v_plan);
  RETURN COALESCE((v_map ->> p_feature_key)::boolean, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_company_plan_feature(
  p_company_id UUID,
  p_feature_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.user_is_admin_master_for_rls() THEN
    RETURN;
  END IF;

  IF NOT public.company_plan_feature_enabled(p_company_id, p_feature_key) THEN
    RAISE EXCEPTION
      'O recurso "%" não está disponível no plano comercial da sua empresa. Ajuste o plano com a EventFest ou peça ao administrador.',
      public.plan_feature_label(p_feature_key);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._company_id_for_event(p_event_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.company_id FROM public.events e WHERE e.id = p_event_id;
$$;

-- Eventos: bloqueia venda de ingressos em plano vitrine; exige feature events_create
CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_plan_feature(NEW.company_id, 'events_create');
  ELSIF TG_OP = 'INSERT' AND NOT public.company_plan_feature_enabled(NEW.company_id, 'events_create') THEN
    RAISE EXCEPTION
      'O recurso "%" não está disponível no plano comercial desta empresa.',
      public.plan_feature_label('events_create');
  END IF;

  SELECT c.billing_plan INTO v_plan
  FROM public.companies c
  WHERE c.id = NEW.company_id;

  IF v_plan = 'listing_monthly'::public.billing_plan_type THEN
    IF COALESCE(NEW.is_paid, false) = true THEN
      RAISE EXCEPTION 'Plano de divulgação (mensalidade) não permite eventos com venda de ingressos.';
    END IF;
    NEW.listing_only := true;
    NEW.is_paid := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_billing_plan_on_events ON public.events;
CREATE TRIGGER trg_enforce_billing_plan_on_events
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_billing_plan_on_events();

-- Pulseiras / lotes de ingressos
CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_wristbands()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  v_company_id := public._company_id_for_event(NEW.event_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Evento não encontrado para vincular ingressos.';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_plan_feature(v_company_id, 'wristbands');
  ELSIF NOT public.company_plan_feature_enabled(v_company_id, 'wristbands') THEN
    RAISE EXCEPTION
      'O recurso "%" não está disponível no plano comercial desta empresa.',
      public.plan_feature_label('wristbands');
  END IF;

  IF NOT public.company_allows_ticket_sales(v_company_id) THEN
    RAISE EXCEPTION 'O plano de divulgação (mensalidade) não permite cadastro de ingressos para venda.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_billing_plan_on_wristbands ON public.wristbands;
CREATE TRIGGER trg_enforce_billing_plan_on_wristbands
  BEFORE INSERT OR UPDATE ON public.wristbands
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_billing_plan_on_wristbands();

-- Chaves de validação na portaria
CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_validation_api_keys()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_company_id := public._company_id_for_event(NEW.event_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Evento não encontrado para vincular a chave de validação.';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_plan_feature(v_company_id, 'validation_keys');
  ELSIF NOT public.company_plan_feature_enabled(v_company_id, 'validation_keys') THEN
    RAISE EXCEPTION
      'O recurso "%" não está disponível no plano comercial desta empresa.',
      public.plan_feature_label('validation_keys');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_billing_plan_on_validation_api_keys ON public.validation_api_keys;
CREATE TRIGGER trg_enforce_billing_plan_on_validation_api_keys
  BEFORE INSERT OR UPDATE ON public.validation_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_billing_plan_on_validation_api_keys();

REVOKE ALL ON FUNCTION public.plan_feature_label(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_plan_feature_enabled(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_feature_label(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_plan_feature_enabled(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_plan_feature_enabled(UUID, TEXT) TO service_role;
