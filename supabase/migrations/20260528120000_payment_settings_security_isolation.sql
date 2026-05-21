-- Isolamento: gestor só lê as próprias credenciais de ingresso; admin só lê credenciais da plataforma.

CREATE OR REPLACE FUNCTION public.get_payment_settings_masked(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_gateway_name TEXT;
  v_api_key_last4 TEXT;
  v_api_token_last4 TEXT;
  v_api_token_ciphertext TEXT;
  v_updated_at TIMESTAMPTZ;
BEGIN
  -- Apenas o próprio usuário (gestor). Admin Master não consulta credenciais de gestores.
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para credenciais de pagamento de ingressos.';
  END IF;

  SELECT
    ps.user_id,
    ps.gateway_name,
    ps.api_key_last4,
    ps.api_token_last4,
    ps.api_token_ciphertext,
    ps.updated_at
  INTO
    v_user_id,
    v_gateway_name,
    v_api_key_last4,
    v_api_token_last4,
    v_api_token_ciphertext,
    v_updated_at
  FROM public.payment_settings ps
  WHERE ps.user_id = p_user_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'configured', false,
      'gateway_name', 'Mercado Pago',
      'api_key_last4', null,
      'api_token_last4', null
    );
  END IF;

  RETURN jsonb_build_object(
    'configured', (v_api_token_ciphertext IS NOT NULL AND length(v_api_token_ciphertext) > 0),
    'gateway_name', COALESCE(v_gateway_name, 'Mercado Pago'),
    'api_key_last4', v_api_key_last4,
    'api_token_last4', v_api_token_last4,
    'updated_at', v_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_mp_settings_masked()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_mp_access_token_ciphertext TEXT;
  v_platform_mp_public_key_last4 TEXT;
  v_platform_mp_token_last4 TEXT;
  v_platform_mp_updated_at TIMESTAMPTZ;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode ver credenciais da plataforma (mensalidade).';
  END IF;

  SELECT
    s.platform_mp_access_token_ciphertext,
    s.platform_mp_public_key_last4,
    s.platform_mp_token_last4,
    s.platform_mp_updated_at
  INTO
    v_platform_mp_access_token_ciphertext,
    v_platform_mp_public_key_last4,
    v_platform_mp_token_last4,
    v_platform_mp_updated_at
  FROM public.system_billing_settings s
  WHERE s.id = 1;

  RETURN jsonb_build_object(
    'configured', (
      v_platform_mp_access_token_ciphertext IS NOT NULL
      AND length(v_platform_mp_access_token_ciphertext) > 0
    ),
    'public_key_last4', v_platform_mp_public_key_last4,
    'token_last4', v_platform_mp_token_last4,
    'updated_at', v_platform_mp_updated_at
  );
END;
$$;
