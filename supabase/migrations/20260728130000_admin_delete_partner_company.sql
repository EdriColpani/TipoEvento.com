-- Exclusão segura de empresa parceira cadastrada por engano (somente Admin Master).

CREATE OR REPLACE FUNCTION public.admin_delete_partner_company(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.companies%ROWTYPE;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT * INTO v_row FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF v_row.company_kind IS DISTINCT FROM 'partner'::public.company_kind THEN
    RAISE EXCEPTION 'Só é possível excluir empresas parceiras por aqui.';
  END IF;

  IF v_row.billing_plan_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Não é possível excluir: o gestor já confirmou o plano comercial.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.events e WHERE e.company_id = p_company_id LIMIT 1) THEN
    RAISE EXCEPTION 'Não é possível excluir: a empresa possui eventos cadastrados.';
  END IF;

  DELETE FROM public.user_companies WHERE company_id = p_company_id;
  DELETE FROM public.companies WHERE id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_partner_company(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_partner_company(UUID) TO authenticated;
