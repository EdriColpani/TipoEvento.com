-- Impede gravar lotes com soma abaixo do mínimo da empresa (planos comissão/híbrido).

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
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_enforce_min_event_batch_quantity ON public.event_batches;
CREATE TRIGGER trg_enforce_min_event_batch_quantity
  AFTER INSERT OR UPDATE OR DELETE ON public.event_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_min_event_batch_quantity();

REVOKE ALL ON FUNCTION public.enforce_min_event_batch_quantity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_min_event_batch_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_min_event_batch_quantity() TO service_role;
