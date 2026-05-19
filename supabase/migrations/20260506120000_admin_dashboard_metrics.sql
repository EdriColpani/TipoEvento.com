-- Métricas agregadas para o Dashboard Admin Master.
-- SECURITY DEFINER: contadores globais sem depender de políticas RLS de leitura em profiles/companies.
-- Acesso: apenas usuário autenticado com profiles.tipo_usuario_id = 1 (Admin Master).

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  month_start timestamptz := date_trunc('month', timezone('utc', now()));
  profiles_has_ca boolean;
  companies_has_ca boolean;
  events_has_ca boolean;
  v_profiles_month bigint := 0;
  v_companies_month bigint := 0;
  v_events_month bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.tipo_usuario_id = 1
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'profiles' AND c.column_name = 'created_at'
  ) INTO profiles_has_ca;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'companies' AND c.column_name = 'created_at'
  ) INTO companies_has_ca;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'events' AND c.column_name = 'created_at'
  ) INTO events_has_ca;

  IF profiles_has_ca THEN
    EXECUTE 'select count(*)::bigint from public.profiles where created_at >= $1'
      INTO v_profiles_month USING month_start;
  END IF;

  IF companies_has_ca THEN
    EXECUTE 'select count(*)::bigint from public.companies where created_at >= $1'
      INTO v_companies_month USING month_start;
  END IF;

  IF events_has_ca THEN
    EXECUTE 'select count(*)::bigint from public.events where created_at >= $1'
      INTO v_events_month USING month_start;
  END IF;

  RETURN json_build_object(
    'total_profiles', (SELECT count(*)::bigint FROM public.profiles),
    'manager_profiles', (SELECT count(*)::bigint FROM public.profiles WHERE tipo_usuario_id = 2),
    'client_profiles', (SELECT count(*)::bigint FROM public.profiles WHERE tipo_usuario_id = 3),
    'total_companies', (SELECT count(*)::bigint FROM public.companies),
    'profiles_this_month', v_profiles_month,
    'companies_this_month', v_companies_month,
    'total_events', (SELECT count(*)::bigint FROM public.events),
    'active_events', (SELECT count(*)::bigint FROM public.events WHERE coalesce(is_active, true) = true),
    'events_this_month', v_events_month
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_metrics() TO authenticated;
