-- Fase 5 (base): regras operacionais dos planos híbrido e consumo + parâmetros admin

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS hybrid_plan_notes TEXT,
  ADD COLUMN IF NOT EXISTS consumption_plan_notes TEXT,
  ADD COLUMN IF NOT EXISTS consumption_module_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hybrid_consumption_module_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.system_billing_settings.consumption_module_enabled IS 'Quando true, libera módulo de consumo (fase completa futura).';
COMMENT ON COLUMN public.system_billing_settings.hybrid_consumption_module_enabled IS 'Quando true, libera consumo no plano híbrido.';

-- Venda de ingressos: comissão + híbrido; não em vitrine nem consumo/licença
CREATE OR REPLACE FUNCTION public.company_allows_ticket_sales(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT c.billing_plan IN (
        'ticket_commission'::public.billing_plan_type,
        'ticket_plus_consumption'::public.billing_plan_type
      )
      FROM public.companies c
      WHERE c.id = p_company_id
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.event_allows_ticket_sales(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        NOT COALESCE(e.listing_only, false)
        AND public.company_allows_ticket_sales(e.company_id)
      FROM public.events e
      WHERE e.id = p_event_id
    ),
    false
  );
$$;

-- Eventos: vitrine forçada em listing_monthly e consumption_or_license
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

  IF v_plan IN (
    'listing_monthly'::public.billing_plan_type,
    'consumption_or_license'::public.billing_plan_type
  ) THEN
    IF COALESCE(NEW.is_paid, false) = true THEN
      RAISE EXCEPTION 'Este plano comercial não permite eventos com venda de ingressos pela plataforma.';
    END IF;
    NEW.listing_only := true;
    NEW.is_paid := false;
  END IF;

  RETURN NEW;
END;
$$;

-- Matriz: plano consumo sem ingressos/chaves até módulo ativo
UPDATE public.billing_plan_features
SET enabled = false, updated_at = timezone('utc'::text, now())
WHERE billing_plan = 'consumption_or_license'::public.billing_plan_type
  AND feature_key IN ('wristbands', 'validation_keys', 'reports_financial', 'reports_sales', 'reports_wristband_movements');

UPDATE public.billing_plan_features
SET enabled = true, updated_at = timezone('utc'::text, now())
WHERE billing_plan = 'consumption_or_license'::public.billing_plan_type
  AND feature_key IN ('dashboard', 'events', 'events_create', 'events_banners', 'reports', 'reports_events', 'reports_registrations', 'settings');
