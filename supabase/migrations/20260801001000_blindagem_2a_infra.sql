-- BLINDAGEM CAMADA 2 (parte 1) — infraestrutura da trava.
--
-- Tres tabelas de apoio:
--   security_guard_baseline  fotografia do que ja existia. A trava so endurece
--                            objeto que NAO esta aqui, para nao quebrar o que
--                            hoje depende de anon (checkout publico, etc).
--   security_change_window   janela de autorizacao. Comando perigoso so passa
--                            com uma janela aberta e ainda valida.
--   security_ddl_audit       trilha de tudo que mexeu em estrutura/permissao.

CREATE TABLE IF NOT EXISTS public.security_guard_baseline (
  object_kind     TEXT NOT NULL,
  object_identity TEXT NOT NULL,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (object_kind, object_identity)
);

CREATE TABLE IF NOT EXISTS public.security_change_window (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by   UUID,
  reason      TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.security_ddl_audit (
  id              BIGSERIAL PRIMARY KEY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  db_user         TEXT NOT NULL DEFAULT current_user,
  command_tag     TEXT,
  object_kind     TEXT,
  object_identity TEXT,
  verdict         TEXT NOT NULL,
  details         TEXT,
  query           TEXT,
  alerted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS security_ddl_audit_occurred_idx
  ON public.security_ddl_audit (occurred_at DESC);
CREATE INDEX IF NOT EXISTS security_ddl_audit_pendente_alerta_idx
  ON public.security_ddl_audit (occurred_at)
  WHERE alerted_at IS NULL AND verdict IN ('bloqueado', 'auto_fechado', 'atencao');

-- Fotografia do estado atual: tudo que existe hoje entra como "ja conhecido".
-- Isso e conscientemente um grandfathering, nao um atestado de que esta seguro
-- (as 262 funcoes com anon seguem na fila de auditoria) — serve so para a trava
-- distinguir "objeto novo nasceu aberto" de "objeto antigo ja era assim".
-- A identidade precisa sair no mesmo formato que pg_event_trigger_ddl_commands
-- devolve (public.f(integer)). regprocedure omite o schema quando ele esta no
-- search_path, e ai a comparacao no gatilho nunca casa.
INSERT INTO public.security_guard_baseline (object_kind, object_identity)
SELECT 'function', format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ON CONFLICT DO NOTHING;

INSERT INTO public.security_guard_baseline (object_kind, object_identity)
SELECT 'relation', (n.nspname || '.' || c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f')
ON CONFLICT DO NOTHING;

ALTER TABLE public.security_guard_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_change_window  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_ddl_audit      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.security_guard_baseline FROM anon, authenticated;
REVOKE ALL ON TABLE public.security_change_window  FROM anon, authenticated;
REVOKE ALL ON TABLE public.security_ddl_audit      FROM anon, authenticated;

-- Admin Master le a trilha pelo painel; escrita e so do dono/service_role.
GRANT SELECT ON TABLE public.security_ddl_audit      TO authenticated;
GRANT SELECT ON TABLE public.security_change_window  TO authenticated;

DROP POLICY IF EXISTS security_ddl_audit_admin_read ON public.security_ddl_audit;
CREATE POLICY security_ddl_audit_admin_read ON public.security_ddl_audit
  FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS security_change_window_admin_read ON public.security_change_window;
CREATE POLICY security_change_window_admin_read ON public.security_change_window
  FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());
