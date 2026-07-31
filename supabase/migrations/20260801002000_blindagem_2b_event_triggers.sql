-- BLINDAGEM CAMADA 2 (parte 2) — os event triggers.
--
-- Dois gatilhos complementares:
--
--   security_guard_block_trg  (ddl_command_start)
--     Barra comando perigoso ANTES de executar: GRANT para anon/PUBLIC, remocao
--     de policy, desligamento de RLS e reabertura do default privilege. So passa
--     com uma janela de autorizacao aberta.
--
--   security_guard_harden_trg (ddl_command_end)
--     Fecha automaticamente o que nasceu aberto: revoga anon/PUBLIC de funcao
--     nova e liga RLS em tabela nova. Nao encosta em objeto do baseline, entao
--     nada que ja funciona hoje muda de comportamento.
--
-- Escape hatch, se algum dia atrapalhar uma manutencao legitima:
--   ALTER EVENT TRIGGER security_guard_block_trg DISABLE;
--   ALTER EVENT TRIGGER security_guard_harden_trg DISABLE;
-- (a tag ALTER EVENT TRIGGER nao e interceptada, de proposito)

CREATE OR REPLACE FUNCTION public.security_change_window_is_open()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.security_change_window
    WHERE expires_at > timezone('utc', now())
  );
$$;

REVOKE ALL ON FUNCTION public.security_change_window_is_open() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.security_change_window_is_open() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.security_open_change_window(
  p_reason  TEXT,
  p_minutes INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires TIMESTAMPTZ;
  v_id UUID;
BEGIN
  IF NOT (
    current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR public.user_is_admin_master_for_rls()
  ) THEN
    RAISE EXCEPTION 'Somente Admin Master pode abrir janela de mudanca de seguranca.';
  END IF;

  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da janela de mudanca.';
  END IF;

  -- Teto de 2h: janela esquecida aberta e o mesmo que nao ter trava.
  v_expires := timezone('utc', now()) + make_interval(mins => least(greatest(p_minutes, 1), 120));

  INSERT INTO public.security_change_window (opened_by, reason, expires_at)
  VALUES (auth.uid(), trim(p_reason), v_expires)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'expires_at', v_expires);
END;
$$;

REVOKE ALL ON FUNCTION public.security_open_change_window(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.security_open_change_window(TEXT, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.security_close_change_window()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF NOT (
    current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR public.user_is_admin_master_for_rls()
  ) THEN
    RAISE EXCEPTION 'Somente Admin Master pode fechar janela de mudanca de seguranca.';
  END IF;

  DELETE FROM public.security_change_window WHERE expires_at > timezone('utc', now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'janelas_fechadas', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.security_close_change_window() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.security_close_change_window() TO authenticated, service_role;


-- ---------------------------------------------------------------- bloqueio ---
CREATE OR REPLACE FUNCTION public.security_guard_block()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query  TEXT;
  v_motivo TEXT;
BEGIN
  IF current_setting('app.security_guard_busy', true) = '1' THEN
    RETURN;
  END IF;

  -- A plataforma Supabase mantem os schemas dela como supabase_admin/auth_admin.
  -- Interceptar esses papeis quebraria upgrade de extensao sem ganho nenhum:
  -- o risco que estamos tratando entra por migration/SQL editor, que rodam como postgres.
  IF current_user <> 'postgres' THEN
    RETURN;
  END IF;

  v_query := coalesce(current_query(), '');

  IF tg_tag = 'GRANT' AND v_query ~* '\mto\M[^;]*\m(anon|public)\M' THEN
    v_motivo := 'GRANT abrindo acesso para anon/PUBLIC';
  ELSIF tg_tag = 'DROP POLICY' THEN
    v_motivo := 'remocao de policy de RLS';
  ELSIF tg_tag = 'ALTER TABLE' AND v_query ~* 'disable\s+row\s+level\s+security' THEN
    v_motivo := 'desligamento de RLS';
  ELSIF tg_tag = 'ALTER DEFAULT PRIVILEGES'
        AND v_query ~* '\mgrant\M' AND v_query ~* '\m(anon|public)\M' THEN
    v_motivo := 'reabertura do default privilege para anon/PUBLIC';
  END IF;

  IF v_motivo IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('app.security_guard_busy', '1', true);

  IF public.security_change_window_is_open() THEN
    INSERT INTO public.security_ddl_audit (command_tag, verdict, details, query)
    VALUES (tg_tag, 'permitido', v_motivo || ' — autorizado por janela aberta', left(v_query, 4000));
    PERFORM set_config('app.security_guard_busy', '0', true);
    RETURN;
  END IF;

  PERFORM set_config('app.security_guard_busy', '0', true);

  -- O INSERT de auditoria morreria no rollback do EXCEPTION, entao a tentativa
  -- bloqueada vai para o log do Postgres, que sobrevive.
  RAISE WARNING 'BLINDAGEM bloqueou: % | usuario=% | query=%', v_motivo, current_user, left(v_query, 500);

  RAISE EXCEPTION 'BLINDAGEM: % foi bloqueado.', v_motivo
    USING HINT = 'Se a mudanca e intencional, rode antes: SELECT public.security_open_change_window(''motivo da mudanca'', 15);';
END;
$$;


-- ------------------------------------------------- fechamento automatico ---
CREATE OR REPLACE FUNCTION public.security_guard_harden()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_rls BOOLEAN;
BEGIN
  IF current_setting('app.security_guard_busy', true) = '1' THEN
    RETURN;
  END IF;
  IF current_user <> 'postgres' THEN
    RETURN;
  END IF;

  PERFORM set_config('app.security_guard_busy', '1', true);

  FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    BEGIN
      IF r.schema_name IS DISTINCT FROM 'public' THEN
        CONTINUE;
      END IF;

      IF r.object_type IN ('function', 'procedure') THEN
        IF EXISTS (
          SELECT 1 FROM public.security_guard_baseline b
          WHERE b.object_kind = 'function' AND b.object_identity = r.object_identity
        ) THEN
          CONTINUE;
        END IF;

        -- Funcao nasce com EXECUTE para PUBLIC por regra do proprio Postgres,
        -- e isso nao e removivel via ALTER DEFAULT PRIVILEGES. Aqui e o unico
        -- ponto onde da para fechar antes de a funcao ficar exposta em /rpc.
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.object_identity);

        INSERT INTO public.security_guard_baseline (object_kind, object_identity)
        VALUES ('function', r.object_identity) ON CONFLICT DO NOTHING;

        INSERT INTO public.security_ddl_audit (command_tag, object_kind, object_identity, verdict, details)
        VALUES (r.command_tag, 'function', r.object_identity, 'auto_fechado',
                'funcao nova: EXECUTE revogado de PUBLIC/anon');

      ELSIF r.object_type IN ('table', 'view', 'materialized view', 'foreign table') THEN
        IF EXISTS (
          SELECT 1 FROM public.security_guard_baseline b
          WHERE b.object_kind = 'relation' AND b.object_identity = r.object_identity
        ) THEN
          CONTINUE;
        END IF;

        EXECUTE format('REVOKE ALL ON %s FROM anon', r.object_identity);

        IF r.object_type = 'table' THEN
          SELECT c.relrowsecurity INTO v_rls
          FROM pg_class c WHERE c.oid = r.objid;

          IF NOT coalesce(v_rls, true) THEN
            -- Tabela sem RLS + grant de authenticated = qualquer logado le e
            -- escreve tudo. Ligar RLS deixa a tabela vazia ate existir policy:
            -- falha visivel em dev, no lugar de vazamento silencioso em prod.
            EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.object_identity);

            INSERT INTO public.security_ddl_audit (command_tag, object_kind, object_identity, verdict, details)
            VALUES (r.command_tag, 'table', r.object_identity, 'auto_fechado',
                    'tabela nova sem RLS: anon revogado e RLS ligado (crie as policies)');
          END IF;
        END IF;

        INSERT INTO public.security_guard_baseline (object_kind, object_identity)
        VALUES ('relation', r.object_identity) ON CONFLICT DO NOTHING;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Blindagem nunca pode derrubar um deploy legitimo por bug proprio.
      RAISE WARNING 'BLINDAGEM (harden) falhou em % %: %', r.object_type, r.object_identity, SQLERRM;
    END;
  END LOOP;

  PERFORM set_config('app.security_guard_busy', '0', true);
END;
$$;


-- Nao sao chamaveis via PostgREST (retornam event_trigger), mas sao SECURITY
-- DEFINER e nasceriam com EXECUTE para PUBLIC como qualquer funcao.
REVOKE ALL ON FUNCTION public.security_guard_block() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_guard_harden() FROM PUBLIC, anon, authenticated;


DROP EVENT TRIGGER IF EXISTS security_guard_block_trg;
CREATE EVENT TRIGGER security_guard_block_trg
  ON ddl_command_start
  WHEN TAG IN ('GRANT', 'DROP POLICY', 'ALTER TABLE', 'ALTER DEFAULT PRIVILEGES')
  EXECUTE FUNCTION public.security_guard_block();

DROP EVENT TRIGGER IF EXISTS security_guard_harden_trg;
CREATE EVENT TRIGGER security_guard_harden_trg
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE', 'CREATE TABLE',
               'CREATE VIEW', 'CREATE MATERIALIZED VIEW', 'CREATE FOREIGN TABLE')
  EXECUTE FUNCTION public.security_guard_harden();
