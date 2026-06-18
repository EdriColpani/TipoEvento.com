-- Notificações admin por e-mail quando chargeback gera absorção EventFest (platform_absorb > 0)

ALTER TABLE public.credit_topup_chargeback_cases
  ADD COLUMN IF NOT EXISTS admin_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notify_resend_id TEXT,
  ADD COLUMN IF NOT EXISTS admin_notify_error TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_topup_chargeback_pending_notify
  ON public.credit_topup_chargeback_cases(created_at DESC)
  WHERE platform_absorb > 0 AND admin_notified_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_admin_master_notification_emails()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    jsonb_agg(DISTINCT lower(trim(u.email)) ORDER BY lower(trim(u.email))),
    '[]'::jsonb
  )
  FROM public.profiles p
  INNER JOIN auth.users u ON u.id = p.id
  WHERE p.tipo_usuario_id = 1
    AND u.email IS NOT NULL
    AND trim(u.email) <> '';
$$;

CREATE OR REPLACE FUNCTION public.get_pending_credit_topup_chargeback_admin_notifications(
  p_limit INTEGER DEFAULT 50,
  p_chargeback_case_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.topup_order_id,
      c.client_user_id,
      c.mp_payment_id,
      c.mp_status,
      c.credit_granted_amount,
      c.wallet_debit,
      c.clawback_manager_total,
      c.platform_absorb,
      c.clawback_settlement_count,
      c.reason,
      c.created_at,
      t.gross_paid_amount,
      t.origin_company_id,
      co.corporate_name AS origin_company_name
    FROM public.credit_topup_chargeback_cases c
    INNER JOIN public.credit_topup_orders t ON t.id = c.topup_order_id
    LEFT JOIN public.companies co ON co.id = t.origin_company_id
    WHERE c.platform_absorb > 0
      AND c.admin_notified_at IS NULL
      AND (p_chargeback_case_id IS NULL OR c.id = p_chargeback_case_id)
    ORDER BY c.created_at ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 100))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_credit_topup_chargeback_admin_notified(
  p_case_id UUID,
  p_resend_id TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Caso de chargeback inválido.';
  END IF;

  UPDATE public.credit_topup_chargeback_cases
  SET
    admin_notified_at = CASE
      WHEN p_error_message IS NULL OR trim(p_error_message) = '' THEN timezone('utc'::text, now())
      ELSE admin_notified_at
    END,
    admin_notify_resend_id = CASE
      WHEN p_error_message IS NULL OR trim(p_error_message) = '' THEN NULLIF(trim(p_resend_id), '')
      ELSE admin_notify_resend_id
    END,
    admin_notify_error = NULLIF(left(trim(COALESCE(p_error_message, '')), 2000), '')
  WHERE id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso de chargeback não encontrado.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'case_id', p_case_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_master_notification_emails() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_credit_topup_chargeback_admin_notifications(INTEGER, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_credit_topup_chargeback_admin_notified(UUID, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_admin_master_notification_emails() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_credit_topup_chargeback_admin_notifications(INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_credit_topup_chargeback_admin_notified(UUID, TEXT, TEXT) TO service_role;

-- Job diário (09:00 UTC): reprocessa alertas pendentes via edge function (pg_net quando disponível)
DO $cron$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_cron indisponível; agende run-credit-chargeback-notify-job manualmente.';
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron: %', SQLERRM;
END
$cron$;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'credit_chargeback_notify_daily';

    PERFORM cron.schedule(
      'credit_chargeback_notify_daily',
      '0 9 * * *',
      $job$
      DO $inner$
      DECLARE
        v_url TEXT;
        v_key TEXT;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
          RAISE NOTICE 'pg_net indisponível; use run-credit-chargeback-notify-job via cron externo.';
          RETURN;
        END IF;

        SELECT decrypted_secret INTO v_url
        FROM vault.decrypted_secrets
        WHERE name = 'supabase_url'
        LIMIT 1;

        SELECT decrypted_secret INTO v_key
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1;

        IF v_url IS NULL OR v_key IS NULL THEN
          RAISE NOTICE 'Vault sem supabase_url/service_role_key; chargeback notify não agendado via HTTP.';
          RETURN;
        END IF;

        PERFORM net.http_post(
          url := rtrim(v_url, '/') || '/functions/v1/run-credit-chargeback-notify-job',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
          ),
          body := '{}'::jsonb
        );
      END
      $inner$;
      $job$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Não foi possível agendar credit_chargeback_notify_daily: %', SQLERRM;
END
$schedule$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_topup_chargebacks(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_platform_absorb_only BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_total INTEGER := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_total
  FROM public.credit_topup_chargeback_cases c
  WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
    AND (NOT COALESCE(p_platform_absorb_only, false) OR c.platform_absorb > 0);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.topup_order_id,
      c.client_user_id,
      c.mp_payment_id,
      c.mp_status,
      c.credit_granted_amount,
      c.wallet_debit,
      c.clawback_manager_total,
      c.platform_absorb,
      c.clawback_settlement_count,
      c.reason,
      c.ledger_entry_id,
      c.admin_notified_at,
      c.created_at,
      t.gross_paid_amount,
      t.origin_company_id,
      co.corporate_name AS origin_company_name,
      t.paid_at AS topup_paid_at
    FROM public.credit_topup_chargeback_cases c
    INNER JOIN public.credit_topup_orders t ON t.id = c.topup_order_id
    LEFT JOIN public.companies co ON co.id = t.origin_company_id
    WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
      AND (NOT COALESCE(p_platform_absorb_only, false) OR c.platform_absorb > 0)
    ORDER BY c.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object(
    'items', v_rows,
    'total', v_total
  );
END;
$$;
