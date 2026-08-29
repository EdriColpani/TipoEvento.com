-- Gestão de operadores PDV: desvincular membro e cancelar convite pendente.
-- Não apaga auth.users / profiles — o usuário pode continuar como cliente.

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

  RETURN jsonb_build_object(
    'ok', true,
    'removed_user_id', p_user_id,
    'company_id', p_company_id,
    'message', 'Acesso de operador PDV removido. A conta do usuário permanece ativa.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_company_member_invite(
  p_company_id UUID,
  p_invite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.company_member_invites%ROWTYPE;
BEGIN
  IF p_company_id IS NULL OR p_invite_id IS NULL THEN
    RAISE EXCEPTION 'Empresa ou convite inválido.';
  END IF;

  IF NOT public.user_owns_company(p_company_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão para cancelar convites desta empresa.';
  END IF;

  SELECT * INTO v_invite
  FROM public.company_member_invites i
  WHERE i.id = p_invite_id
    AND i.company_id = p_company_id;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este convite já foi aceito. Remova o operador na lista de equipe.';
  END IF;

  DELETE FROM public.company_member_invites
  WHERE id = p_invite_id
    AND company_id = p_company_id
    AND accepted_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'invite_id', p_invite_id,
    'company_id', p_company_id,
    'email', v_invite.email,
    'message', 'Convite cancelado.'
  );
END;
$$;

COMMENT ON FUNCTION public.remove_company_member(UUID, UUID) IS
  'Owner/Admin: remove vínculo pdv_operator de user_companies sem apagar a conta Auth.';

COMMENT ON FUNCTION public.cancel_company_member_invite(UUID, UUID) IS
  'Owner/Admin: cancela convite pendente em company_member_invites.';

REVOKE ALL ON FUNCTION public.remove_company_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_company_member_invite(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_company_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_company_member_invite(UUID, UUID) TO authenticated;
