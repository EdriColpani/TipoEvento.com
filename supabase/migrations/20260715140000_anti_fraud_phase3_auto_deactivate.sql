-- Fase 3.1: auto-desativar vitrine após X dias da data do evento (zero vendas).

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS ticket_inactivity_auto_deactivate_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_inactivity_auto_deactivate_days INTEGER NOT NULL DEFAULT 30
    CHECK (ticket_inactivity_auto_deactivate_days >= 0 AND ticket_inactivity_auto_deactivate_days <= 365);

COMMENT ON COLUMN public.system_billing_settings.ticket_inactivity_auto_deactivate_enabled IS
  'Desativa automaticamente eventos ativos sem venda X dias após a data do evento (planos com ingressos).';
COMMENT ON COLUMN public.system_billing_settings.ticket_inactivity_auto_deactivate_days IS
  'Dias após events.date para auto-desativar; 0 = desligado mesmo com enabled true.';

CREATE TABLE IF NOT EXISTS public.event_ticket_auto_deactivate_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  days_after INTEGER NOT NULL,
  ticket_sales_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_auto_deactivate_log_event
  ON public.event_ticket_auto_deactivate_log(event_id, created_at DESC);

ALTER TABLE public.event_ticket_auto_deactivate_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_ticket_auto_deactivate_log_admin ON public.event_ticket_auto_deactivate_log;
CREATE POLICY event_ticket_auto_deactivate_log_admin
  ON public.event_ticket_auto_deactivate_log
  FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

CREATE OR REPLACE FUNCTION public.event_ticket_sales_total(p_event_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.receivables r
  WHERE r.event_id = p_event_id
    AND (
      COALESCE(r.status, '') = 'paid'
      OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
    );
$$;

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
    INNER JOIN public.companies c ON c.id = e.company_id
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
    SET is_active = false
    WHERE ev.id = v_event.id
      AND COALESCE(ev.is_active, false) = true;

    IF FOUND THEN
      v_deactivated := v_deactivated + 1;

      INSERT INTO public.event_ticket_auto_deactivate_log (
        event_id, company_id, event_date, days_after, ticket_sales_count
      ) VALUES (
        v_event.id, v_event.company_id, v_event.event_date, v_days, v_sales
      );

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
    'events', v_events
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_run_ticket_inactivity_auto_deactivate()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  RETURN public.run_ticket_inactivity_auto_deactivate();
END;
$$;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'ticket_inactivity_auto_deactivate_daily';

      PERFORM cron.schedule(
        'ticket_inactivity_auto_deactivate_daily',
        '0 9 * * *',
        $cmd$SELECT public.run_ticket_inactivity_auto_deactivate();$cmd$
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron ticket_inactivity_auto_deactivate_daily: %', SQLERRM;
    END;
  END IF;
END;
$cron$;

REVOKE ALL ON FUNCTION public.event_ticket_sales_total(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_ticket_inactivity_auto_deactivate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_run_ticket_inactivity_auto_deactivate() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_ticket_sales_total(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_ticket_inactivity_auto_deactivate() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_run_ticket_inactivity_auto_deactivate() TO authenticated;
