-- A fila de webhooks do Mercado Pago só era drenada pelo disparo fire-and-forget
-- do próprio webhook. Se esse disparo falhasse, o job ficava "pending" para sempre
-- e o pagamento nunca era concluído. Este cron garante o reprocessamento.
--
-- Depende dos segredos 'supabase_url' e 'service_role_key' no Vault:
--   select vault.create_secret('https://<ref>.supabase.co', 'supabase_url');
--   select vault.create_secret('<service_role_key>', 'service_role_key');

CREATE OR REPLACE FUNCTION public.drain_payment_webhook_jobs()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
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

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Vault sem supabase_url/service_role_key: % job(s) de webhook parados na fila.', v_pending;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/process-payment-webhook-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('limit', 25)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.drain_payment_webhook_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_payment_webhook_jobs() TO service_role;

COMMENT ON FUNCTION public.drain_payment_webhook_jobs IS
  'Reprocessa jobs de webhook MP pendentes ou com lock expirado (rede de seguranca do disparo direto).';

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'payment_webhook_jobs_drain';

      PERFORM cron.schedule(
        'payment_webhook_jobs_drain',
        '* * * * *',
        $cmd$SELECT public.drain_payment_webhook_jobs()$cmd$
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron payment_webhook_jobs_drain: %', SQLERRM;
    END;
  END IF;
END;
$cron$;
