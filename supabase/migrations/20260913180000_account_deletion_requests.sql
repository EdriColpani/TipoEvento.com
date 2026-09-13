-- Solicitações públicas de exclusão de conta (Google Play / LGPD).
-- NÃO exclui usuário automaticamente. NÃO consulta auth.users.
SELECT public.security_open_change_window('public account deletion request rpc for Play Store', 15);

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  reason TEXT NULL,
  declared_titular BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_email_created
  ON public.account_deletion_requests (requester_email, created_at DESC);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_account_deletion_request(
  p_name TEXT,
  p_email TEXT,
  p_reason TEXT DEFAULT NULL,
  p_declared_titular BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := trim(COALESCE(p_name, ''));
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_reason TEXT := nullif(trim(COALESCE(p_reason, '')), '');
  v_recent INTEGER := 0;
  v_id UUID;
  v_inbox TEXT;
BEGIN
  IF v_name = '' OR char_length(v_name) < 2 THEN
    RAISE EXCEPTION 'Informe seu nome.';
  END IF;
  IF v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido.';
  END IF;
  IF p_declared_titular IS NOT TRUE THEN
    RAISE EXCEPTION 'É necessário declarar que você é o titular ou está autorizado.';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'O motivo deve ter no máximo 2000 caracteres.';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_recent
  FROM public.account_deletion_requests r
  WHERE r.requester_email = v_email
    AND r.created_at > timezone('utc'::text, now()) - INTERVAL '24 hours';

  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'Limite de solicitações atingido. Tente novamente mais tarde.';
  END IF;

  INSERT INTO public.account_deletion_requests (
    requester_name,
    requester_email,
    reason,
    declared_titular
  ) VALUES (
    v_name,
    v_email,
    v_reason,
    true
  )
  RETURNING id INTO v_id;

  v_inbox := format(
    E'[Solicitação de exclusão de conta]\nE-mail informado: %s\nMotivo: %s\nDeclaração: titular da conta ou autorizado.',
    v_email,
    COALESCE(v_reason, '(não informado)')
  );

  INSERT INTO public.contact_messages (name, phone, message)
  VALUES (left(v_name, 200), '0000000000', left(v_inbox, 4000));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON TABLE public.account_deletion_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_account_deletion_request(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_account_deletion_request(TEXT, TEXT, TEXT, BOOLEAN)
  TO anon, authenticated, service_role;

INSERT INTO public.security_exposure_baseline (kind, identity)
SELECT 'function', format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'create_account_deletion_request'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.account_deletion_requests IS
  'Pedidos públicos de exclusão de conta. Não dispara exclusão automática nem confirma existência do e-mail.';
