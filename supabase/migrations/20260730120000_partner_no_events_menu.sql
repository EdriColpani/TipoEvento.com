-- Empresa parceira: sem menu Eventos nem Ingressos (só consumo/PDV).

UPDATE public.billing_plan_features
SET enabled = false, updated_at = now()
WHERE billing_plan = 'consumption_or_license'::public.billing_plan_type
  AND feature_key IN (
    'events',
    'events_create',
    'events_banners',
    'wristbands',
    'validation_keys',
    'reports_events',
    'reports_registrations',
    'reports_wristband_movements',
    'reports_sales',
    'reports_financial'
  );

CREATE OR REPLACE FUNCTION public.get_company_plan_features(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_kind public.company_kind;
  v_ready BOOLEAN;
  v_features JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
    RETURN (
      SELECT COALESCE(jsonb_object_agg(k.feature_key, true), '{}'::jsonb)
      FROM (SELECT DISTINCT feature_key FROM public.billing_plan_features) k
    );
  END IF;

  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para consultar recursos desta empresa.';
  END IF;

  SELECT
    c.billing_plan,
    c.company_kind,
    (
      c.billing_plan IS NOT NULL
      AND NOT COALESCE(c.requires_billing_reacceptance, false)
      AND c.billing_plan_accepted_at IS NOT NULL
      AND c.billing_contract_id IS NOT NULL
    )
  INTO v_plan, v_kind, v_ready
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND OR v_plan IS NULL OR NOT v_ready THEN
    RETURN '{}'::jsonb;
  END IF;

  v_features := public._billing_plan_features_map(v_plan);

  IF v_kind = 'partner'::public.company_kind THEN
    v_features := v_features
      || jsonb_build_object(
        'events', false,
        'events_create', false,
        'events_banners', false,
        'wristbands', false,
        'validation_keys', false,
        'reports_events', false,
        'reports_registrations', false,
        'reports_wristband_movements', false,
        'reports_sales', false,
        'reports_financial', false
      );
  END IF;

  RETURN v_features;
END;
$$;
