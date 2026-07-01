-- Permissões de menu/funcionalidade por plano comercial (configurável pelo Admin Master)
--
-- Pré-requisito: enum billing_plan_type (criado em 20260517120000_company_billing_plans.sql).
-- Bloco abaixo permite rodar esta migration mesmo se o enum ainda não existir no banco.
DO $$ BEGIN
  CREATE TYPE public.billing_plan_type AS ENUM (
    'listing_monthly',
    'ticket_commission',
    'ticket_plus_consumption',
    'consumption_or_license'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_plan_features (
  billing_plan public.billing_plan_type NOT NULL,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (billing_plan, feature_key)
);

COMMENT ON TABLE public.billing_plan_features IS 'Matriz plano x funcionalidade do painel gestor (menu, rotas, APIs).';

ALTER TABLE public.billing_plan_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_plan_features_admin_all" ON public.billing_plan_features;
CREATE POLICY "billing_plan_features_admin_all"
  ON public.billing_plan_features
  FOR ALL
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS "billing_plan_features_select_authenticated" ON public.billing_plan_features;
CREATE POLICY "billing_plan_features_select_authenticated"
  ON public.billing_plan_features
  FOR SELECT
  TO authenticated
  USING (true);

-- Seed padrão (idempotente)
INSERT INTO public.billing_plan_features (billing_plan, feature_key, enabled) VALUES
  ('listing_monthly', 'dashboard', true),
  ('listing_monthly', 'events', true),
  ('listing_monthly', 'events_create', true),
  ('listing_monthly', 'events_banners', true),
  ('listing_monthly', 'wristbands', false),
  ('listing_monthly', 'validation_keys', false),
  ('listing_monthly', 'reports', true),
  ('listing_monthly', 'reports_financial', false),
  ('listing_monthly', 'reports_sales', false),
  ('listing_monthly', 'reports_events', true),
  ('listing_monthly', 'reports_audience', false),
  ('listing_monthly', 'reports_registrations', true),
  ('listing_monthly', 'reports_wristband_movements', false),
  ('listing_monthly', 'reports_listing_monthly', true),
  ('listing_monthly', 'settings', true),
  ('ticket_commission', 'dashboard', true),
  ('ticket_commission', 'events', true),
  ('ticket_commission', 'events_create', true),
  ('ticket_commission', 'events_banners', true),
  ('ticket_commission', 'wristbands', true),
  ('ticket_commission', 'validation_keys', true),
  ('ticket_commission', 'reports', true),
  ('ticket_commission', 'reports_financial', true),
  ('ticket_commission', 'reports_sales', true),
  ('ticket_commission', 'reports_events', true),
  ('ticket_commission', 'reports_audience', true),
  ('ticket_commission', 'reports_registrations', true),
  ('ticket_commission', 'reports_wristband_movements', true),
  ('ticket_commission', 'reports_listing_monthly', false),
  ('ticket_commission', 'settings', true),
  ('ticket_plus_consumption', 'dashboard', true),
  ('ticket_plus_consumption', 'events', true),
  ('ticket_plus_consumption', 'events_create', true),
  ('ticket_plus_consumption', 'events_banners', true),
  ('ticket_plus_consumption', 'wristbands', true),
  ('ticket_plus_consumption', 'validation_keys', true),
  ('ticket_plus_consumption', 'reports', true),
  ('ticket_plus_consumption', 'reports_financial', true),
  ('ticket_plus_consumption', 'reports_sales', true),
  ('ticket_plus_consumption', 'reports_events', true),
  ('ticket_plus_consumption', 'reports_audience', true),
  ('ticket_plus_consumption', 'reports_registrations', true),
  ('ticket_plus_consumption', 'reports_wristband_movements', true),
  ('ticket_plus_consumption', 'reports_listing_monthly', false),
  ('ticket_plus_consumption', 'settings', true),
  ('consumption_or_license', 'dashboard', true),
  ('consumption_or_license', 'events', true),
  ('consumption_or_license', 'events_create', true),
  ('consumption_or_license', 'events_banners', true),
  ('consumption_or_license', 'wristbands', false),
  ('consumption_or_license', 'validation_keys', false),
  ('consumption_or_license', 'reports', true),
  ('consumption_or_license', 'reports_financial', false),
  ('consumption_or_license', 'reports_sales', false),
  ('consumption_or_license', 'reports_events', true),
  ('consumption_or_license', 'reports_audience', false),
  ('consumption_or_license', 'reports_registrations', true),
  ('consumption_or_license', 'reports_wristband_movements', false),
  ('consumption_or_license', 'reports_listing_monthly', false),
  ('consumption_or_license', 'settings', true)
ON CONFLICT (billing_plan, feature_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._billing_plan_features_map(p_plan public.billing_plan_type)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(feature_key, enabled),
    '{}'::jsonb
  )
  FROM public.billing_plan_features
  WHERE billing_plan = p_plan;
$$;

CREATE OR REPLACE FUNCTION public.get_company_plan_features(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_ready BOOLEAN;
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
    RETURN '{}'::jsonb;
  END IF;

  RETURN public._billing_plan_features_map(v_plan);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_has_plan_feature(
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
  v_features JSONB;
BEGIN
  IF public.user_is_admin_master_for_rls() THEN
    RETURN true;
  END IF;

  v_features := public.get_company_plan_features(p_company_id);
  RETURN COALESCE((v_features ->> p_feature_key)::boolean, false);
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

  IF NOT public.company_has_plan_feature(p_company_id, p_feature_key) THEN
    RAISE EXCEPTION
      'Recurso "%" não disponível no plano comercial da empresa.',
      p_feature_key;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_billing_plan_features_matrix()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'billing_plan', billing_plan::text,
          'feature_key', feature_key,
          'enabled', enabled
        )
        ORDER BY billing_plan::text, feature_key
      ),
      '[]'::jsonb
    )
    FROM public.billing_plan_features
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_billing_plan_features(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_plan public.billing_plan_type;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Payload inválido.';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_plan := (v_row->>'billing_plan')::public.billing_plan_type;
    INSERT INTO public.billing_plan_features (billing_plan, feature_key, enabled, updated_by, updated_at)
    VALUES (
      v_plan,
      v_row->>'feature_key',
      COALESCE((v_row->>'enabled')::boolean, false),
      auth.uid(),
      timezone('utc'::text, now())
    )
    ON CONFLICT (billing_plan, feature_key)
    DO UPDATE SET
      enabled = EXCLUDED.enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_plan_features(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_has_plan_feature(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_company_plan_feature(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_billing_plan_features_matrix() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_save_billing_plan_features(JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_company_plan_features(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_has_plan_feature(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_company_plan_feature(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_billing_plan_features_matrix() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_billing_plan_features(JSONB) TO authenticated;
