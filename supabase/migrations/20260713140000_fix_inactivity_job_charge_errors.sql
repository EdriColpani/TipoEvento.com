-- Job mensal: não abortar verificação se cobrança opcional falhar; corrige contador por empresa.

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
      v_sales := public.event_ticket_sales_in_month(v_event.id, v_month);

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
