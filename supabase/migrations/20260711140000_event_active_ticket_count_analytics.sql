-- Contagem de ingressos ativos = registros em wristband_analytics (alinhado ao campo "Quantidade" no cadastro).

CREATE OR REPLACE FUNCTION public.event_active_wristband_count(p_event_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.wristband_analytics wa
  INNER JOIN public.wristbands w ON w.id = wa.wristband_id
  WHERE w.event_id = p_event_id
    AND w.status = 'active'
    AND wa.status = 'active'
    AND COALESCE(w.price, 0) > 0;
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
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

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

  IF v_count > 0 AND v_count < v_min THEN
    RAISE EXCEPTION
      'É necessário ter pelo menos % ingressos ativos neste evento. Total atual: %.',
      v_min, v_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_min_event_ticket_analytics_quantity ON public.wristband_analytics;
CREATE TRIGGER trg_enforce_min_event_ticket_analytics_quantity
  AFTER INSERT ON public.wristband_analytics
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_min_event_ticket_analytics_quantity();

REVOKE ALL ON FUNCTION public.enforce_min_event_ticket_analytics_quantity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_min_event_ticket_analytics_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_min_event_ticket_analytics_quantity() TO service_role;
