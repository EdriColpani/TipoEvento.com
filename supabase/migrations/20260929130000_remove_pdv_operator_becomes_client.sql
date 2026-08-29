-- Ao remover operador PDV: se não restar vínculo de empresa, vira cliente (tipo 3).

CREATE OR REPLACE FUNCTION public.remove_company_member(
  p_company_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.user_companies%ROWTYPE;
  v_remaining INTEGER := 0;
  v_became_client BOOLEAN := false;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Empresa ou usuário inválido.';
  END IF;

  IF NOT public.user_owns_company(p_company_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão para remover membros desta empresa.';
  END IF;

  SELECT * INTO v_member
  FROM public.user_companies uc
  WHERE uc.company_id = p_company_id
    AND uc.user_id = p_user_id;

  IF v_member.user_id IS NULL THEN
    RAISE EXCEPTION 'Este usuário não está vinculado à empresa.';
  END IF;

  IF COALESCE(v_member.role, 'owner') = 'owner'
     OR COALESCE(v_member.is_primary, false) = true THEN
    RAISE EXCEPTION 'Não é permitido remover o proprietário da empresa por este fluxo.';
  END IF;

  IF COALESCE(v_member.role, '') IS DISTINCT FROM 'pdv_operator' THEN
    RAISE EXCEPTION 'Somente operadores PDV podem ser desvinculados por este fluxo.';
  END IF;

  DELETE FROM public.user_companies
  WHERE company_id = p_company_id
    AND user_id = p_user_id
    AND role = 'pdv_operator';

  SELECT COUNT(*)::integer INTO v_remaining
  FROM public.user_companies uc
  WHERE uc.user_id = p_user_id;

  -- Sem vínculo restante com empresas → perfil de cliente (acesso à área do cliente).
  IF v_remaining = 0 THEN
    UPDATE public.profiles
    SET tipo_usuario_id = 3
    WHERE id = p_user_id
      AND COALESCE(tipo_usuario_id, 0) <> 1;
    v_became_client := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'removed_user_id', p_user_id,
    'company_id', p_company_id,
    'became_client', v_became_client,
    'message', CASE
      WHEN v_became_client THEN
        'Acesso de operador removido. O usuário passou a ser cliente EventFest.'
      ELSE
        'Acesso de operador PDV removido nesta empresa. A conta permanece ativa.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_company_member(UUID, UUID) TO authenticated;
