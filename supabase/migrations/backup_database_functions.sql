-- ============================================
-- Funções para backup do banco (uso pela Edge Function)
-- Apenas Administrador Global pode acionar o backup pela aplicação.
-- ============================================

-- Lista nomes das tabelas do esquema public (ordem para respeitar FKs depois)
CREATE OR REPLACE FUNCTION get_public_table_names()
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tablename::text
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename;
$$;

-- Gera DDL do esquema public: CREATE TABLE, PRIMARY KEY, FOREIGN KEY, RLS
CREATE OR REPLACE FUNCTION get_public_schema_ddl()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, information_schema
AS $$
DECLARE
  r RECORD;
  tname text;
  ddl text := '';
  col_def text;
  pk_def text;
  fk_def text;
  pol_def text;
BEGIN
  -- Cabeçalho
  ddl := '-- Backup gerado em ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS') || E'\n';
  ddl := ddl || '-- Esquema público: tabelas, PKs, FKs, funções, procedures, triggers e políticas RLS' || E'\n\n';

  FOR tname IN SELECT get_public_table_names()
  LOOP
    -- CREATE TABLE com colunas (nome, tipo, default, not null)
    SELECT string_agg(
      quote_ident(a.attname) || ' ' ||
      pg_catalog.format_type(a.atttypid, a.atttypmod) ||
      CASE WHEN a.atthasdef THEN ' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid) ELSE '' END ||
      CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
      ', ' ORDER BY a.attnum
    ) INTO col_def
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON (d.adrelid = a.attrelid AND d.adnum = a.attnum)
    JOIN pg_catalog.pg_class c ON (c.oid = a.attrelid)
    JOIN pg_catalog.pg_namespace n ON (n.oid = c.relnamespace)
    WHERE n.nspname = 'public'
      AND c.relname = tname
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF col_def IS NOT NULL AND col_def <> '' THEN
      ddl := ddl || 'CREATE TABLE IF NOT EXISTS public.' || quote_ident(tname) || ' (' || E'\n  ' || col_def || E'\n);' || E'\n\n';
    END IF;

    -- PRIMARY KEY
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY array_position(cc.conkey, a.attnum))
    INTO pk_def
    FROM pg_catalog.pg_constraint cc
    JOIN pg_catalog.pg_class c ON (c.oid = cc.conrelid)
    JOIN pg_catalog.pg_namespace n ON (n.oid = c.relnamespace)
    JOIN pg_catalog.pg_attribute a ON (a.attrelid = cc.conrelid AND a.attnum = ANY(cc.conkey) AND NOT a.attisdropped)
    WHERE n.nspname = 'public' AND c.relname = tname AND cc.contype = 'p';

    IF pk_def IS NOT NULL AND pk_def <> '' THEN
      ddl := ddl || 'ALTER TABLE ONLY public.' || quote_ident(tname) || ' ADD CONSTRAINT ' || quote_ident(tname || '_pkey') || ' PRIMARY KEY (' || pk_def || ');' || E'\n\n';
    END IF;
  END LOOP;

  -- FOREIGN KEYS (após todas as tabelas existirem); uma linha por constraint
  FOR r IN
    SELECT
      tc.table_name AS tbl,
      tc.constraint_name AS conname,
      (SELECT string_agg(quote_ident(kcu2.column_name), ', ' ORDER BY kcu2.ordinal_position)
       FROM information_schema.key_column_usage kcu2
       WHERE kcu2.table_schema = 'public' AND kcu2.constraint_name = tc.constraint_name AND kcu2.table_name = tc.table_name) AS cols,
      (SELECT max(ccu2.table_name) FROM information_schema.constraint_column_usage ccu2
       WHERE ccu2.table_schema = 'public' AND ccu2.constraint_name = tc.constraint_name) AS ref_tbl,
      (SELECT string_agg(quote_ident(ccu2.column_name), ', ')
       FROM information_schema.constraint_column_usage ccu2
       WHERE ccu2.table_schema = 'public' AND ccu2.constraint_name = tc.constraint_name) AS ref_cols
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
  LOOP
    IF r.cols IS NOT NULL AND r.ref_cols IS NOT NULL AND r.ref_tbl IS NOT NULL THEN
      fk_def := 'ALTER TABLE ONLY public.' || quote_ident(r.tbl) || ' ADD CONSTRAINT ' || quote_ident(r.conname) ||
        ' FOREIGN KEY (' || r.cols || ') REFERENCES public.' || quote_ident(r.ref_tbl) || '(' || r.ref_cols || ');';
      ddl := ddl || fk_def || E'\n';
    END IF;
  END LOOP;
  ddl := ddl || E'\n';

  -- FUNCTIONS e PROCEDURES (esquema public)
  ddl := ddl || '-- Funções e Procedures' || E'\n\n';
  FOR r IN
    SELECT p.oid AS proc_oid, p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON (p.pronamespace = n.oid)
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p', 'a', 'w')  -- f=function, p=procedure, a=aggregate, w=window
    ORDER BY p.proname
  LOOP
    BEGIN
      ddl := ddl || pg_catalog.pg_get_functiondef(r.proc_oid) || E'\n\n';
    EXCEPTION WHEN OTHERS THEN
      ddl := ddl || '-- Erro ao obter definição de ' || quote_ident(r.proname) || ': ' || SQLERRM || E'\n';
    END;
  END LOOP;

  -- TRIGGERS (definições)
  ddl := ddl || '-- Triggers' || E'\n\n';
  FOR r IN
    SELECT tgname, relname AS tablename, pg_get_triggerdef(t.oid, true) AS def
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON (t.tgrelid = c.oid)
    JOIN pg_catalog.pg_namespace n ON (c.relnamespace = n.oid)
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
    ORDER BY relname, tgname
  LOOP
    IF r.def IS NOT NULL AND r.def <> '' THEN
      ddl := ddl || r.def || ';' || E'\n';
    END IF;
  END LOOP;
  ddl := ddl || E'\n';

  -- RLS: habilitar RLS e políticas
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON (n.oid = c.relnamespace)
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    ddl := ddl || 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;' || E'\n';
  END LOOP;

  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    pol_def := 'CREATE POLICY ' || quote_ident(r.policyname) || ' ON public.' || quote_ident(r.tablename);
    pol_def := pol_def || ' AS ' || CASE WHEN r.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END;
    pol_def := pol_def || ' FOR ' || r.cmd;
    IF r.roles IS NOT NULL AND array_length(r.roles, 1) > 0 THEN
      pol_def := pol_def || ' TO ' || array_to_string(array(SELECT quote_ident(unnest) FROM unnest(r.roles)), ', ');
    END IF;
    IF r.qual IS NOT NULL AND r.qual <> '' THEN
      pol_def := pol_def || ' USING (' || r.qual || ')';
    END IF;
    IF r.with_check IS NOT NULL AND r.with_check <> '' THEN
      pol_def := pol_def || ' WITH CHECK (' || r.with_check || ')';
    END IF;
    pol_def := pol_def || ';';
    ddl := ddl || pol_def || E'\n';
  END LOOP;

  RETURN ddl;
END;
$$;

-- Permissão para a role service (Edge Function)
GRANT EXECUTE ON FUNCTION get_public_table_names() TO service_role;
GRANT EXECUTE ON FUNCTION get_public_schema_ddl() TO service_role;
