-- O drain autenticava no worker comparando a service role key com a env
-- SUPABASE_SERVICE_ROLE_KEY injetada na edge function. Essa igualdade de string
-- quebra sempre que a chave e rotacionada (ou quando o projeto migra para o
-- formato sb_secret_), derrubando o cron com 401 silencioso. Passa a usar um
-- token dedicado, rotacionavel sem tocar na chave mestra.

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

  IF v_name NOT IN ('supabase_url', 'service_role_key', 'webhook_worker_token') THEN
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

CREATE OR REPLACE FUNCTION public.drain_payment_webhook_jobs()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_token TEXT;
  v_pending INTEGER;
BEGIN
  SELECT count(*) INTO v_pending
  FROM public.payment_webhook_jobs
  WHERE status = 'pending'
     OR (status = 'processing' AND locked_at < timezone('utc'::text, now()) - INTERVAL '5 minutes');

  IF v_pending = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 'pg_net indisponivel: % job(s) de webhook parados na fila.', v_pending;
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'webhook_worker_token' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL OR v_token IS NULL THEN
    RAISE WARNING 'Vault incompleto (supabase_url/service_role_key/webhook_worker_token): % job(s) parados na fila.', v_pending;
    RETURN;
  END IF;

  -- Authorization satisfaz o verify_jwt do gateway; o token dedicado e o que
  -- de fato autoriza o worker.
  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/process-payment-webhook-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'x-webhook-worker-token', v_token
    ),
    body := jsonb_build_object('limit', 25)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.drain_payment_webhook_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_payment_webhook_jobs() TO service_role;
