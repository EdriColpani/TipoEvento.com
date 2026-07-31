-- BLINDAGEM CAMADA 1 — inverter o padrao de permissoes do schema public.
--
-- Causa raiz dos quatro incidentes de 31/07/2026 (RPCs financeiras abertas,
-- funcoes mutantes anonimas, views de relatorio vazando faturamento e PII,
-- dados bancarios expostos): o default privilege do Supabase concede tudo a
-- anon em cada objeto novo de public --
--   tabelas  -> anon=arwdDxtm  (SELECT, INSERT, UPDATE, DELETE, TRUNCATE...)
--   funcoes  -> anon=X         (EXECUTE)
--   sequences-> anon=rwU
-- Ou seja: tabela criada sem RLS nasce gravavel por qualquer visitante, e
-- funcao SECURITY DEFINER nasce chamavel por /rest/v1/rpc sem autenticacao.
-- Revogar caso a caso nao escala — o proximo objeto nasce aberto de novo.
--
-- A partir daqui o acesso publico passa a ser decisao explicita: quando um
-- objeto realmente precisar de anon, o GRANT vai junto na migration.
-- Falha visivel em desenvolvimento e muito melhor que exposicao silenciosa em
-- producao. Nada muda para objetos ja existentes.
--
-- authenticated permanece como esta: e o modelo normal do Supabase (grant amplo
-- + RLS por politica). O risco de tabela sem RLS e coberto pela camada 2.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Revogar so de anon nao basta em funcao: o proprio Postgres concede EXECUTE a
-- PUBLIC por padrao, e anon herda por ai. Sem esta linha a camada 1 nao segura
-- funcao nenhuma. authenticated e service_role continuam via grant explicito do
-- default ACL do Supabase.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- O painel do Supabase cria objetos como supabase_admin. Se o papel atual nao
-- for membro dele, o comando falha — nesse caso o default so vale para o que
-- vier por migration, que ja cobre o fluxo normal do projeto.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
  RAISE NOTICE 'Default privileges de supabase_admin nao alterados: %', SQLERRM;
END;
$$;
