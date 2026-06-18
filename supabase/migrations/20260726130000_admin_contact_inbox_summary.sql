-- Resumo de mensagens de contato para o sininho do Admin Master

CREATE OR REPLACE FUNCTION public.get_admin_contact_inbox_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RETURN jsonb_build_object('new_count', 0);
  END IF;

  SELECT count(*)::INTEGER
  INTO v_count
  FROM public.contact_messages m
  WHERE m.status = 'new';

  RETURN jsonb_build_object('new_count', COALESCE(v_count, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_contact_inbox_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_contact_inbox_summary() TO authenticated;
