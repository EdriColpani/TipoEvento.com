-- Fase 4 operacional: e-mail ao auto-desativar + reativar evento em venda tardia.

ALTER TABLE public.company_ticket_inactivity_notifications
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.company_ticket_inactivity_notifications
  DROP CONSTRAINT IF EXISTS company_ticket_inactivity_notifications_unique;

ALTER TABLE public.company_ticket_inactivity_notifications
  DROP CONSTRAINT IF EXISTS company_ticket_inactivity_notifications_type_check;

ALTER TABLE public.company_ticket_inactivity_notifications
  ADD CONSTRAINT company_ticket_inactivity_notifications_type_check
  CHECK (notification_type IN ('blocked', 'charge_created', 'auto_deactivated'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_inactivity_notifications_unique_v2
  ON public.company_ticket_inactivity_notifications (
    company_id,
    reference_month,
    notification_type,
    COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE OR REPLACE FUNCTION public.receivable_is_paid_row(
  p_status TEXT,
  p_payment_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') = 'paid'
    OR COALESCE(p_payment_status, '') IN ('approved', 'authorized');
$$;

CREATE OR REPLACE FUNCTION public.queue_ticket_inactivity_notification(
  p_company_id UUID,
  p_reference_month DATE,
  p_notification_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_event_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT NULLIF(trim(c.email), '')
  INTO v_email
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_email IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.company_ticket_inactivity_notifications n
    WHERE n.company_id = p_company_id
      AND n.reference_month = date_trunc('month', p_reference_month)::date
      AND n.notification_type = p_notification_type
      AND COALESCE(n.event_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND n.sent_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.company_ticket_inactivity_notifications (
    company_id, reference_month, recipient_email, notification_type, payload, event_id
  )
  VALUES (
    p_company_id,
    date_trunc('month', p_reference_month)::date,
    v_email,
    p_notification_type,
    COALESCE(p_payload, '{}'::jsonb),
    p_event_id
  )
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_try_reactivate_auto_deactivated_event_on_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_was_paid BOOLEAN;
  v_is_paid BOOLEAN;
BEGIN
  v_was_paid := TG_OP = 'UPDATE' AND public.receivable_is_paid_row(OLD.status, OLD.payment_status);
  v_is_paid := public.receivable_is_paid_row(NEW.status, NEW.payment_status);

  IF NOT v_is_paid OR v_was_paid THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.company_id
  INTO v_company_id
  FROM public.events e
  WHERE e.id = NEW.event_id;

  IF v_company_id IS NULL OR NOT public.company_requires_paid_ticket_event(v_company_id) THEN
    RETURN NEW;
  END IF;

  UPDATE public.events ev
  SET
    is_active = true,
    auto_deactivated_at = NULL
  WHERE ev.id = NEW.event_id
    AND ev.auto_deactivated_at IS NOT NULL
    AND COALESCE(ev.is_active, false) = false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_try_reactivate_auto_deactivated_event_on_sale ON public.receivables;
CREATE TRIGGER trg_try_reactivate_auto_deactivated_event_on_sale
  AFTER INSERT OR UPDATE OF status, payment_status ON public.receivables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_try_reactivate_auto_deactivated_event_on_sale();

CREATE OR REPLACE FUNCTION public.run_ticket_inactivity_auto_deactivate()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN := false;
  v_days INTEGER := 0;
  v_today DATE;
  v_event RECORD;
  v_sales INTEGER;
  v_deactivated INTEGER := 0;
  v_notifications_queued INTEGER := 0;
  v_events JSONB := '[]'::jsonb;
BEGIN
  SELECT
    COALESCE(s.ticket_inactivity_auto_deactivate_enabled, false),
    COALESCE(s.ticket_inactivity_auto_deactivate_days, 0)
  INTO v_enabled, v_days
  FROM public.system_billing_settings s
  WHERE s.id = 1;

  IF NOT v_enabled OR v_days <= 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', CASE WHEN NOT v_enabled THEN 'disabled' ELSE 'days_zero' END
    );
  END IF;

  v_today := (timezone('America/Sao_Paulo', now()))::date;

  FOR v_event IN
    SELECT
      e.id,
      e.company_id,
      e.title,
      e.date::date AS event_date
    FROM public.events e
    WHERE public.company_requires_paid_ticket_event(e.company_id)
      AND COALESCE(e.is_active, false) = true
      AND COALESCE(e.is_paid, false) = true
      AND COALESCE(e.listing_only, false) = false
      AND e.date IS NOT NULL
      AND (e.date::date + v_days) <= v_today
  LOOP
    v_sales := public.event_ticket_sales_total(v_event.id);

    IF v_sales > 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.events ev
    SET
      is_active = false,
      auto_deactivated_at = timezone('utc'::text, now())
    WHERE ev.id = v_event.id
      AND COALESCE(ev.is_active, false) = true;

    IF FOUND THEN
      v_deactivated := v_deactivated + 1;

      INSERT INTO public.event_ticket_auto_deactivate_log (
        event_id, company_id, event_date, days_after, ticket_sales_count
      ) VALUES (
        v_event.id, v_event.company_id, v_event.event_date, v_days, v_sales
      );

      PERFORM public.queue_ticket_inactivity_notification(
        v_event.company_id,
        v_event.event_date,
        'auto_deactivated',
        jsonb_build_object(
          'event_id', v_event.id,
          'event_title', v_event.title,
          'event_date', v_event.event_date,
          'days_after', v_days
        ),
        v_event.id
      );
      v_notifications_queued := v_notifications_queued + 1;

      v_events := v_events || jsonb_build_array(
        jsonb_build_object(
          'event_id', v_event.id,
          'company_id', v_event.company_id,
          'title', v_event.title,
          'event_date', v_event.event_date
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'days_after', v_days,
    'events_deactivated', v_deactivated,
    'notifications_queued', v_notifications_queued,
    'events', v_events
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_anti_fraud_deploy()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cron_monthly BOOLEAN := false;
  v_cron_auto BOOLEAN := false;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'ticket_inactivity_monthly_check'
    ) INTO v_cron_monthly;

    SELECT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'ticket_inactivity_auto_deactivate_daily'
    ) INTO v_cron_auto;
  END IF;

  RETURN jsonb_build_object(
    'columns', jsonb_build_object(
      'events_auto_deactivated_at', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'auto_deactivated_at'
      ),
      'settings_auto_deactivate_enabled', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'system_billing_settings'
          AND column_name = 'ticket_inactivity_auto_deactivate_enabled'
      )
    ),
    'functions', jsonb_build_object(
      'run_ticket_inactivity_auto_deactivate', to_regprocedure('public.run_ticket_inactivity_auto_deactivate()') IS NOT NULL,
      'event_ticket_sales_through_month_end', to_regprocedure('public.event_ticket_sales_through_month_end(uuid,date)') IS NOT NULL,
      'verify_anti_fraud_deploy', to_regprocedure('public.verify_anti_fraud_deploy()') IS NOT NULL
    ),
    'pg_cron', jsonb_build_object(
      'extension_enabled', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),
      'ticket_inactivity_monthly_check', v_cron_monthly,
      'ticket_inactivity_auto_deactivate_daily', v_cron_auto
    ),
    'tables', jsonb_build_object(
      'event_ticket_auto_deactivate_log', to_regclass('public.event_ticket_auto_deactivate_log') IS NOT NULL,
      'company_ticket_inactivity_charges', to_regclass('public.company_ticket_inactivity_charges') IS NOT NULL
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receivable_is_paid_row(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_anti_fraud_deploy() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.receivable_is_paid_row(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_anti_fraud_deploy() TO authenticated;
