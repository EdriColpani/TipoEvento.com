-- Fase 3.4: log de bypass Admin Master em lotes e cadastro de ingressos.

CREATE OR REPLACE FUNCTION public.enforce_min_event_batch_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_company_id UUID;
  v_min INTEGER;
  v_sum INTEGER;
  v_is_master BOOLEAN;
BEGIN
  v_is_master := auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls();
  v_event_id := COALESCE(NEW.event_id, OLD.event_id);

  SELECT e.company_id
  INTO v_company_id
  FROM public.events e
  WHERE e.id = v_event_id;

  IF v_company_id IS NULL OR NOT public.company_requires_paid_ticket_event(v_company_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_min := public.get_company_min_event_tickets(v_company_id);
  v_sum := public.event_batch_ticket_quantity_sum(v_event_id);

  IF v_is_master THEN
    IF v_sum > 0 AND v_sum < v_min THEN
      PERFORM public.log_admin_master_bypass(
        'min_event_tickets_batch',
        format('Admin Master salvou lotes com soma %s (mínimo %s).', v_sum, v_min),
        v_company_id,
        v_event_id,
        jsonb_build_object('batch_sum', v_sum, 'min_required', v_min)
      );
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF v_sum > 0 AND v_sum < v_min THEN
    RAISE EXCEPTION
      'A soma das quantidades dos lotes deve ser pelo menos % ingressos (mínimo da sua empresa).',
      v_min;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_min_event_ticket_analytics_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_company_id UUID;
  v_min INTEGER;
  v_count INTEGER;
  v_is_master BOOLEAN;
BEGIN
  v_is_master := auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls();

  SELECT w.event_id, w.company_id
  INTO v_event_id, v_company_id
  FROM public.wristbands w
  WHERE w.id = NEW.wristband_id;

  IF v_event_id IS NULL OR v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.company_requires_paid_ticket_event(v_company_id) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(
    (SELECT w2.price FROM public.wristbands w2 WHERE w2.id = NEW.wristband_id),
    0
  ) <= 0 THEN
    RETURN NEW;
  END IF;

  v_min := public.get_company_min_event_tickets(v_company_id);
  v_count := public.event_active_wristband_count(v_event_id);

  IF v_is_master THEN
    IF v_count > 0 AND v_count < v_min THEN
      PERFORM public.log_admin_master_bypass(
        'min_event_tickets_register',
        format('Admin Master cadastrou ingressos com total %s (mínimo %s).', v_count, v_min),
        v_company_id,
        v_event_id,
        jsonb_build_object('active_count', v_count, 'min_required', v_min)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF v_count > 0 AND v_count < v_min THEN
    RAISE EXCEPTION
      'É necessário ter pelo menos % ingressos ativos neste evento. Total atual: %.',
      v_min, v_count;
  END IF;

  RETURN NEW;
END;
$$;
