-- OAuth Mercado Pago (gestor / vendedor marketplace) + collector_id

ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS mp_collector_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_public_key TEXT,
  ADD COLUMN IF NOT EXISTS mp_refresh_token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS mp_oauth_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mp_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mp_connection_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (mp_connection_source IN ('manual', 'oauth'));

COMMENT ON COLUMN public.payment_settings.mp_collector_id IS 'user_id numérico do vendedor no MP (collector).';
COMMENT ON COLUMN public.payment_settings.mp_connection_source IS 'manual = token colado; oauth = Conectar com Mercado Pago.';

CREATE TABLE IF NOT EXISTS public.mp_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_mp_oauth_states_user_id ON public.mp_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_mp_oauth_states_expires ON public.mp_oauth_states(expires_at);

ALTER TABLE public.mp_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mp_oauth_states_deny_authenticated"
  ON public.mp_oauth_states FOR ALL TO authenticated USING (false) WITH CHECK (false);

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
  v_mp_collector_id TEXT;
  v_mp_oauth_connected_at TIMESTAMPTZ;
  v_mp_connection_source TEXT;
  v_mp_token_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para credenciais de pagamento de ingressos.';
  END IF;

  SELECT
    ps.user_id, ps.gateway_name, ps.api_key_last4, ps.api_token_last4,
    ps.api_token_ciphertext, ps.updated_at, ps.mp_collector_id,
    ps.mp_oauth_connected_at, ps.mp_connection_source, ps.mp_token_expires_at
  INTO
    v_user_id, v_gateway_name, v_api_key_last4, v_api_token_last4,
    v_api_token_ciphertext, v_updated_at, v_mp_collector_id,
    v_mp_oauth_connected_at, v_mp_connection_source, v_mp_token_expires_at
  FROM public.payment_settings ps
  WHERE ps.user_id = p_user_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'configured', false,
      'oauth_connected', false,
      'gateway_name', 'Mercado Pago',
      'api_key_last4', null,
      'api_token_last4', null,
      'mp_collector_id', null,
      'connection_source', 'manual'
    );
  END IF;

  RETURN jsonb_build_object(
    'configured', (v_api_token_ciphertext IS NOT NULL AND length(v_api_token_ciphertext) > 0),
    'oauth_connected', (v_mp_connection_source = 'oauth' AND v_mp_oauth_connected_at IS NOT NULL),
    'gateway_name', COALESCE(v_gateway_name, 'Mercado Pago'),
    'api_key_last4', v_api_key_last4,
    'api_token_last4', v_api_token_last4,
    'mp_collector_id', v_mp_collector_id,
    'connection_source', COALESCE(v_mp_connection_source, 'manual'),
    'oauth_connected_at', v_mp_oauth_connected_at,
    'token_expires_at', v_mp_token_expires_at,
    'updated_at', v_updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_settings_masked(UUID) TO authenticated;
