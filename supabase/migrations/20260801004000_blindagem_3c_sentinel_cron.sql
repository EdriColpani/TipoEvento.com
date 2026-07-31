-- BLINDAGEM CAMADA 3 (parte 2) — job diario e autenticacao dedicada.
--
-- Mesmo padrao do drain de webhooks: Authorization do Vault so satisfaz o
-- gateway; o segredo dedicado e o que autoriza de fato. Comparar com a
-- SUPABASE_SERVICE_ROLE_KEY da edge function quebra quando o projeto tem
-- chave no formato novo e no legado ao mesmo tempo.

CREATE OR REPLACE FUNCTION public.admin_set_vault_secret(
  p_name TEXT,
  p_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := NULLIF(trim(p_name), '');
  v_secret TEXT := NULLIF(p_secret, '');
  v_id UUID;
BEGIN
  IF v_name IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Nome e valor do segredo sao obrigatorios.';
  END IF;

  IF v_name NOT IN (
    'supabase_url',
    'service_role_key',
    'webhook_worker_token',
    'security_sentinel_secret'
  ) THEN
    RAISE EXCEPTION 'Segredo "%" nao permitido por esta RPC.', v_name;
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name LIMIT 1;

  IF v_id IS NULL THEN
    v_id := vault.create_secret(v_secret, v_name);
    RETURN jsonb_build_object('ok', true, 'action', 'created', 'name', v_name);
  END IF;

  PERFORM vault.update_secret(v_id, v_secret, v_name);
  RETURN jsonb_build_object('ok', true, 'action', 'updated', 'name', v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_vault_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_vault_secret(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.run_security_sentinel()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_secret TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 'pg_net indisponivel: sentinela de seguranca nao executada.';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'security_sentinel_secret' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'Vault incompleto: sentinela de seguranca nao executada.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/security-sentinel-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'x-security-sentinel-secret', v_secret
    ),
    body := jsonb_build_object('origem', 'cron')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_security_sentinel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_security_sentinel() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'security_sentinel_daily';
      PERFORM cron.schedule(
        'security_sentinel_daily',
        '0 12 * * *',
        $cmd$SELECT public.run_security_sentinel()$cmd$
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron security_sentinel_daily: %', SQLERRM;
    END;
  END IF;
END;
$cron$;
