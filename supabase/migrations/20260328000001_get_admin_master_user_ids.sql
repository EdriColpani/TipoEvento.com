-- Expõe os UUIDs de Admin Master (tipo_usuario_id = 1) para filtros no cliente (ex.: dropdown de chaves de validação).
-- SECURITY DEFINER: gestores não leem a tabela profiles alheia via RLS, mas precisam saber quais eventos foram criados pelo master.
CREATE OR REPLACE FUNCTION public.get_admin_master_user_ids()
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p.tipo_usuario_id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_admin_master_user_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_master_user_ids() TO authenticated;
