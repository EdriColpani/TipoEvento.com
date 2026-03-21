-- RLS para gestor ver vínculo user_companies e dados de companies.
-- Sem SELECT permitido aqui, o cliente recebe 0 linhas → company_id nunca resolve e o formulário de evento falha.
--
-- Onde ver no Supabase: Table Editor → tabela user_companies ou companies → aba / botão "RLS policies"
-- (ou SQL: select * from pg_policies where tablename in ('user_companies','companies');)

CREATE OR REPLACE FUNCTION public.user_is_admin_master_for_rls()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 1
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_admin_master_for_rls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_admin_master_for_rls() TO authenticated;

ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- user_companies: remove políticas com os nomes que passamos a usar (idempotente)
DROP POLICY IF EXISTS "user_companies_select_own" ON public.user_companies;
DROP POLICY IF EXISTS "user_companies_insert_own" ON public.user_companies;
DROP POLICY IF EXISTS "user_companies_update_own" ON public.user_companies;
DROP POLICY IF EXISTS "user_companies_delete_own" ON public.user_companies;

CREATE POLICY "user_companies_select_own"
  ON public.user_companies
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_companies_insert_own"
  ON public.user_companies
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_companies_update_own"
  ON public.user_companies
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_companies_delete_own"
  ON public.user_companies
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- companies: leitura para quem é membro OU admin master
DROP POLICY IF EXISTS "companies_select_member_or_admin" ON public.companies;
DROP POLICY IF EXISTS "companies_insert_gestor_pro" ON public.companies;
DROP POLICY IF EXISTS "companies_update_member_or_admin" ON public.companies;

CREATE POLICY "companies_select_member_or_admin"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = companies.id
        AND uc.user_id = auth.uid()
    )
  );

-- Gestor PRO pode criar empresa (cadastro PJ / empresa sintética PF no app)
CREATE POLICY "companies_insert_gestor_pro"
  ON public.companies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.tipo_usuario_id = 2
    )
  );

-- Atualização: admin master ou membro da empresa (ex.: completar cadastro)
CREATE POLICY "companies_update_member_or_admin"
  ON public.companies
  FOR UPDATE
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = companies.id
        AND uc.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = companies.id
        AND uc.user_id = auth.uid()
    )
  );
