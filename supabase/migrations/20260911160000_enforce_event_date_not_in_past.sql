-- Impede criar evento com data anterior a hoje (America/Sao_Paulo).
-- Em UPDATE, só bloqueia se a data for alterada para o passado.

CREATE OR REPLACE FUNCTION public.enforce_event_date_not_in_past()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_today DATE := (timezone('America/Sao_Paulo', now()))::date;
BEGIN
  IF NEW.date IS NULL THEN
    RAISE EXCEPTION 'A data do evento é obrigatória.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.date < v_today THEN
      RAISE EXCEPTION 'A data do evento não pode ser anterior a hoje.';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: permite manter data antiga já gravada; bloqueia mudar para o passado.
  IF NEW.date IS DISTINCT FROM OLD.date AND NEW.date < v_today THEN
    RAISE EXCEPTION 'A data do evento não pode ser anterior a hoje.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_date_not_in_past ON public.events;
CREATE TRIGGER trg_enforce_event_date_not_in_past
  BEFORE INSERT OR UPDATE OF date ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_date_not_in_past();

COMMENT ON FUNCTION public.enforce_event_date_not_in_past() IS
  'Bloqueia INSERT de evento com date < hoje (SP) e UPDATE que altere date para o passado.';
