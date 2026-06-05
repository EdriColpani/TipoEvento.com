-- Melhorias pós fase 3: vendas acumuladas no job dia 5, auto_deactivated_at, log admin.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS auto_deactivated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.events.auto_deactivated_at IS
  'Preenchido quando o job de auto-desativação comercial desliga is_active (planos com ingressos).';

CREATE OR REPLACE FUNCTION public.event_ticket_sales_through_month_end(
  p_event_id UUID,
  p_reference_month DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.receivables r
  WHERE r.event_id = p_event_id
    AND r.created_at < (date_trunc('month', p_reference_month)::date + INTERVAL '1 month')::timestamptz
    AND (
      COALESCE(r.status, '') = 'paid'
      OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
    );
$$;

COMMENT ON FUNCTION public.event_ticket_sales_through_month_end(UUID, DATE) IS
  'Vendas pagas do evento até o fim do mês de referência (inclui vendas em meses anteriores à data do evento).';

CREATE OR REPLACE FUNCTION public.run_ticket_inactivity_check(p_reference_month DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_enabled BOOLEAN;
  v_company RECORD;
  v_event RECORD;
  v_sales INTEGER;
  v_flagged INTEGER := 0;
  v_companies_blocked INTEGER := 0;
  v_company_flagged BOOLEAN;
  v_company_events_flagged INTEGER;
  v_charges_created INTEGER := 0;
  v_notifications_queued INTEGER := 0;
  v_charge JSONB;
  v_was_blocked BOOLEAN;
BEGIN
  v_month := COALESCE(
    p_reference_month,
    (date_trunc('month', timezone('utc'::text, now())) - INTERVAL '1 month')::date
  );
  v_month := date_trunc('month', v_month)::date;

  SELECT COALESCE(s.ticket_inactivity_enabled, true)
  INTO v_enabled
  FROM public.system_billing_settings s
  WHERE s.id = 1;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'disabled');
  END IF;

  FOR v_company IN
    SELECT c.id, c.ticket_inactivity_blocked, c.email, c.corporate_name
    FROM public.companies c
    WHERE public.company_requires_paid_ticket_event(c.id)
  LOOP
    v_company_flagged := false;
    v_company_events_flagged := 0;
    v_was_blocked := COALESCE(v_company.ticket_inactivity_blocked, false);

    FOR v_event IN
      SELECT e.id, e.title, e.date
      FROM public.events e
      WHERE e.company_id = v_company.id
        AND COALESCE(e.is_paid, false) = true
        AND COALESCE(e.listing_only, false) = false
        AND e.date >= v_month
        AND e.date < (v_month + INTERVAL '1 month')::date
    LOOP
      v_sales := public.event_ticket_sales_through_month_end(v_event.id, v_month);

      IF v_sales = 0 THEN
        INSERT INTO public.company_ticket_inactivity_flags (
          company_id, event_id, reference_month, event_title, ticket_sales_count
        )
        VALUES (
          v_company.id, v_event.id, v_month, v_event.title, v_sales
        )
        ON CONFLICT (company_id, event_id, reference_month)
        DO UPDATE SET
          event_title = EXCLUDED.event_title,
          ticket_sales_count = EXCLUDED.ticket_sales_count,
          resolved_at = NULL,
          resolved_by = NULL;

        v_flagged := v_flagged + 1;
        v_company_events_flagged := v_company_events_flagged + 1;
        v_company_flagged := true;
      END IF;
    END LOOP;

    IF v_company_flagged THEN
      UPDATE public.companies c
      SET
        ticket_inactivity_blocked = true,
        ticket_inactivity_blocked_at = timezone('utc'::text, now()),
        ticket_inactivity_reference_month = v_month
      WHERE c.id = v_company.id;

      v_companies_blocked := v_companies_blocked + 1;

      IF NOT v_was_blocked THEN
        PERFORM public.queue_ticket_inactivity_notification(
          v_company.id,
          v_month,
          'blocked',
          jsonb_build_object('events_flagged', v_company_events_flagged)
        );
        v_notifications_queued := v_notifications_queued + 1;
      END IF;

      BEGIN
        v_charge := public.ensure_ticket_inactivity_charge(v_company.id, v_month);
        IF COALESCE((v_charge->>'skipped')::boolean, false) = false
           AND COALESCE((v_charge->>'already_paid')::boolean, false) = false
           AND (v_charge->>'charge_id') IS NOT NULL THEN
          v_charges_created := v_charges_created + 1;
          PERFORM public.queue_ticket_inactivity_notification(
            v_company.id,
            v_month,
            'charge_created',
            jsonb_build_object(
              'charge_id', v_charge->>'charge_id',
              'amount', v_charge->>'amount'
            )
          );
          v_notifications_queued := v_notifications_queued + 1;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE NOTICE 'ensure_ticket_inactivity_charge falhou para %: %', v_company.id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reference_month', v_month,
    'events_flagged', v_flagged,
    'companies_blocked', v_companies_blocked,
    'charges_created', v_charges_created,
    'notifications_queued', v_notifications_queued
  );
END;
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

CREATE OR REPLACE FUNCTION public.trg_clear_event_auto_deactivated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.is_active, false) = true
     AND COALESCE(OLD.is_active, false) = false
     AND NEW.auto_deactivated_at IS NOT NULL THEN
    NEW.auto_deactivated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_event_auto_deactivated_at ON public.events;
CREATE TRIGGER trg_clear_event_auto_deactivated_at
  BEFORE UPDATE OF is_active ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clear_event_auto_deactivated_at();

CREATE OR REPLACE FUNCTION public.admin_list_event_auto_deactivate_log(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      l.id,
      l.event_id,
      l.company_id,
      l.event_date,
      l.days_after,
      l.ticket_sales_count,
      l.created_at,
      e.title AS event_title,
      COALESCE(NULLIF(trim(c.trade_name), ''), c.corporate_name) AS company_name
    FROM public.event_ticket_auto_deactivate_log l
    INNER JOIN public.events e ON e.id = l.event_id
    INNER JOIN public.companies c ON c.id = l.company_id
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) s;

  RETURN jsonb_build_object('rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.event_ticket_sales_through_month_end(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_event_auto_deactivate_log(INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_ticket_sales_through_month_end(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_event_auto_deactivate_log(INTEGER) TO authenticated;
