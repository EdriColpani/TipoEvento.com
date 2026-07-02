-- Detecta gestor parceiro que ainda precisa criar senha (metadata ou convite owner pendente).

CREATE OR REPLACE FUNCTION public.user_must_set_partner_password()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      (
        SELECT (u.raw_user_meta_data ->> 'password_setup_required')::boolean
        FROM auth.users u
        WHERE u.id = auth.uid()
      ),
      false
    )
    OR EXISTS (
      SELECT 1
      FROM public.company_member_invites i
      INNER JOIN auth.users u ON u.id = auth.uid()
      WHERE lower(trim(i.email)) = lower(trim(u.email))
        AND i.role = 'owner'
        AND i.accepted_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.user_must_set_partner_password() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_must_set_partner_password() TO authenticated;
