-- BLINDAGEM CAMADA 3 (parte 1) — deteccao de desvio.
--
-- A camada 2 impede o que passa pelo caminho normal. Esta camada existe para o
-- que escapar: alguem desabilita o event trigger, mexe pelo painel com outro
-- papel, ou uma policy nasce permissiva demais. O metodo e comparar a superficie
-- exposta hoje com uma linha de base e reportar o que aumentou.

CREATE TABLE IF NOT EXISTS public.security_exposure_baseline (
  kind          TEXT NOT NULL,
  identity      TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (kind, identity)
);

REVOKE ALL ON TABLE public.security_exposure_baseline FROM anon, authenticated;

-- Retrato do estado atual. De novo: e "o que existe hoje", nao "o que esta
-- correto hoje". A auditoria das 262 funcoes com anon segue em aberto; o que
-- este retrato garante e que nada NOVO se abra sem ninguem perceber.
INSERT INTO public.security_exposure_baseline (kind, identity)
SELECT 'function', format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_exposure_baseline (kind, identity)
SELECT 'relation', format('%s.%s', n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f')
  AND has_table_privilege('anon', c.oid, 'SELECT')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_exposure_baseline (kind, identity)
SELECT 'policy', format('%s.%s: %s', pol.schemaname, pol.tablename, pol.policyname)
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND pol.permissive = 'PERMISSIVE'
  AND (pol.roles @> ARRAY['public']::name[] OR pol.roles @> ARRAY['anon']::name[])
  AND coalesce(pol.qual, 'true') = 'true'
ON CONFLICT DO NOTHING;


CREATE OR REPLACE FUNCTION public.security_drift_report()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_achados JSONB := '[]'::jsonb;
BEGIN
  IF NOT (
    current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR public.user_is_admin_master_for_rls()
  ) THEN
    RAISE EXCEPTION 'Somente Admin Master.';
  END IF;

  -- Funcao nova chamavel sem login
  SELECT v_achados || coalesce(jsonb_agg(jsonb_build_object(
           'severidade', 'critico', 'tipo', 'funcao_exposta_a_anon', 'objeto', ident)), '[]'::jsonb)
  INTO v_achados
  FROM (
    SELECT format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS ident
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) f
  WHERE NOT EXISTS (
    SELECT 1 FROM public.security_exposure_baseline b WHERE b.kind='function' AND b.identity = f.ident
  );

  -- Tabela/view nova legivel sem login
  SELECT v_achados || coalesce(jsonb_agg(jsonb_build_object(
           'severidade', 'critico', 'tipo', 'tabela_legivel_por_anon', 'objeto', ident)), '[]'::jsonb)
  INTO v_achados
  FROM (
    SELECT format('%s.%s', n.nspname, c.relname) AS ident
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p','f')
      AND has_table_privilege('anon', c.oid, 'SELECT')
  ) t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.security_exposure_baseline b WHERE b.kind='relation' AND b.identity = t.ident
  );

  -- Tabela sem RLS: qualquer logado le e escreve tudo
  SELECT v_achados || coalesce(jsonb_agg(jsonb_build_object(
           'severidade', 'critico', 'tipo', 'tabela_sem_rls', 'objeto', format('%s.%s', n.nspname, c.relname))), '[]'::jsonb)
  INTO v_achados
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;

  -- Policy nova liberando tudo para anon/public (foi assim que o CPF vazou)
  SELECT v_achados || coalesce(jsonb_agg(jsonb_build_object(
           'severidade', 'alto', 'tipo', 'policy_permissiva_para_anon', 'objeto', ident)), '[]'::jsonb)
  INTO v_achados
  FROM (
    SELECT format('%s.%s: %s', pol.schemaname, pol.tablename, pol.policyname) AS ident
    FROM pg_policies pol
    WHERE pol.schemaname='public' AND pol.permissive='PERMISSIVE'
      AND (pol.roles @> ARRAY['public']::name[] OR pol.roles @> ARRAY['anon']::name[])
      AND coalesce(pol.qual, 'true') = 'true'
  ) p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.security_exposure_baseline b WHERE b.kind='policy' AND b.identity = p.ident
  );

  -- A propria blindagem desligada
  SELECT v_achados || coalesce(jsonb_agg(jsonb_build_object(
           'severidade', 'critico', 'tipo', 'blindagem_desativada', 'objeto', evtname)), '[]'::jsonb)
  INTO v_achados
  FROM pg_event_trigger
  WHERE evtname IN ('security_guard_block_trg', 'security_guard_harden_trg') AND evtenabled = 'D';

  SELECT v_achados || CASE WHEN count(*) = 2 THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object(
           'severidade', 'critico', 'tipo', 'blindagem_removida',
           'objeto', 'security_guard_block_trg / security_guard_harden_trg')) END
  INTO v_achados
  FROM pg_event_trigger WHERE evtname IN ('security_guard_block_trg', 'security_guard_harden_trg');

  -- Default privilege reaberto para anon
  SELECT v_achados || coalesce(jsonb_agg(jsonb_build_object(
           'severidade', 'alto', 'tipo', 'default_privilege_reaberto_para_anon',
           'objeto', format('%s / tipo %s', pg_get_userbyid(d.defaclrole), d.defaclobjtype))), '[]'::jsonb)
  INTO v_achados
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname='public' AND pg_get_userbyid(d.defaclrole) = 'postgres'
    AND d.defaclacl::text LIKE '%anon=%';

  RETURN jsonb_build_object(
    'gerado_em', timezone('utc', now()),
    'total', jsonb_array_length(v_achados),
    'achados', v_achados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.security_drift_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.security_drift_report() TO authenticated, service_role;
