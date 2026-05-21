-- Separação de credenciais MP:
-- - Ingressos: PAYMENT_API_KEY_SECRET (env) + payment_settings criptografado por gestor
-- - Plataforma (mensalidade, recorrência): PLATFORM_MP_ACCESS_TOKEN (env) + system_billing_settings criptografado
--
-- Compatível com payment_settings legada (api_key / api_token em texto claro).

-- 1) Garantir tabela base (instalações novas e legadas)
CREATE TABLE IF NOT EXISTS public.payment_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 2) Colunas novas (tabela já existente não recebia colunas só com CREATE TABLE IF NOT EXISTS)
ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gateway_name TEXT,
  ADD COLUMN IF NOT EXISTS api_key_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS api_token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS api_key_last4 TEXT,
  ADD COLUMN IF NOT EXISTS api_token_last4 TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.payment_settings
SET gateway_name = 'Mercado Pago'
WHERE gateway_name IS NULL;

ALTER TABLE public.payment_settings
  ALTER COLUMN gateway_name SET DEFAULT 'Mercado Pago';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_settings' AND column_name = 'gateway_name'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.payment_settings ALTER COLUMN gateway_name SET NOT NULL;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

UPDATE public.payment_settings
SET created_at = timezone('utc'::text, now())
WHERE created_at IS NULL;

UPDATE public.payment_settings
SET updated_at = timezone('utc'::text, now())
WHERE updated_at IS NULL;

ALTER TABLE public.payment_settings
  ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now()),
  ALTER COLUMN updated_at SET DEFAULT timezone('utc'::text, now());

-- 3) Preservar últimos 4 dígitos antes de remover colunas legadas (gestor re-salva para criptografar)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_settings' AND column_name = 'api_key'
  ) THEN
    UPDATE public.payment_settings
    SET api_key_last4 = right(trim(api_key), 4)
    WHERE api_key IS NOT NULL AND trim(api_key) <> '' AND api_key_last4 IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_settings' AND column_name = 'api_token'
  ) THEN
    UPDATE public.payment_settings
    SET api_token_last4 = right(trim(api_token), 4)
    WHERE api_token IS NOT NULL AND trim(api_token) <> '' AND api_token_last4 IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_settings' AND column_name = 'api_key'
  ) THEN
    ALTER TABLE public.payment_settings DROP COLUMN api_key;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_settings' AND column_name = 'api_token'
  ) THEN
    ALTER TABLE public.payment_settings DROP COLUMN api_token;
  END IF;
END $$;

COMMENT ON TABLE public.payment_settings IS 'Credenciais MP do gestor (ingressos), criptografadas; leitura de token só via Edge Functions.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_settings' AND column_name = 'api_token_ciphertext'
  ) THEN
    COMMENT ON COLUMN public.payment_settings.api_token_ciphertext IS
      'Access token MP do gestor (AES-GCM, base64).';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_settings' AND column_name = 'api_key_ciphertext'
  ) THEN
    COMMENT ON COLUMN public.payment_settings.api_key_ciphertext IS
      'Public key MP do gestor (opcional), criptografada.';
  END IF;
END $$;

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_settings_select_own_masked" ON public.payment_settings;
DROP POLICY IF EXISTS "payment_settings_no_direct_write" ON public.payment_settings;
DROP POLICY IF EXISTS "payment_settings_deny_authenticated" ON public.payment_settings;
CREATE POLICY "payment_settings_deny_authenticated"
  ON public.payment_settings
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Credenciais MP da plataforma (EventFest) — mensalidade, assinatura, cobranças B2B
ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS platform_mp_public_key_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS platform_mp_access_token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS platform_mp_public_key_last4 TEXT,
  ADD COLUMN IF NOT EXISTS platform_mp_token_last4 TEXT,
  ADD COLUMN IF NOT EXISTS platform_mp_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_mp_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.system_billing_settings.platform_mp_access_token_ciphertext IS
  'Access token MP da conta EventFest (mensalidade/recorrência), criptografado.';

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
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    IF NOT public.user_is_admin_master_for_rls() THEN
      RAISE EXCEPTION 'Sem permissão.';
    END IF;
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

GRANT EXECUTE ON FUNCTION public.get_payment_settings_masked(UUID) TO authenticated;

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
    RAISE EXCEPTION 'Apenas Admin Master.';
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

GRANT EXECUTE ON FUNCTION public.get_platform_mp_settings_masked() TO authenticated;
