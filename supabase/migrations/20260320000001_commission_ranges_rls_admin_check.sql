-- Corrige leitura de commission_ranges para Admin Master: a policy com EXISTS em profiles
-- pode falhar quando o RLS de profiles restringe o subselect. Função SECURITY DEFINER
-- lê profiles com privilégios do dono e só expõe um booleano.

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

-- Recria policies de commission_ranges
DROP POLICY IF EXISTS "Admin Master can read commission_ranges" ON public.commission_ranges;
DROP POLICY IF EXISTS "Admin Master can insert commission_ranges" ON public.commission_ranges;
DROP POLICY IF EXISTS "Admin Master can update commission_ranges" ON public.commission_ranges;
DROP POLICY IF EXISTS "Admin Master can delete commission_ranges" ON public.commission_ranges;

CREATE POLICY "Admin Master can read commission_ranges"
  ON public.commission_ranges
  FOR SELECT
  TO authenticated
  USING (public.user_is_admin_master_for_rls());

CREATE POLICY "Admin Master can insert commission_ranges"
  ON public.commission_ranges
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_admin_master_for_rls());

CREATE POLICY "Admin Master can update commission_ranges"
  ON public.commission_ranges
  FOR UPDATE
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

CREATE POLICY "Admin Master can delete commission_ranges"
  ON public.commission_ranges
  FOR DELETE
  TO authenticated
  USING (public.user_is_admin_master_for_rls());

-- commission_ranges_history
DROP POLICY IF EXISTS "Admin Master can read commission_ranges_history" ON public.commission_ranges_history;
DROP POLICY IF EXISTS "Admin Master can insert commission_ranges_history" ON public.commission_ranges_history;

CREATE POLICY "Admin Master can read commission_ranges_history"
  ON public.commission_ranges_history
  FOR SELECT
  TO authenticated
  USING (public.user_is_admin_master_for_rls());

CREATE POLICY "Admin Master can insert commission_ranges_history"
  ON public.commission_ranges_history
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_admin_master_for_rls());
