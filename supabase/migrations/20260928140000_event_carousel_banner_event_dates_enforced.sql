-- Banner de evento: 1 por evento (já existe UNIQUE event_id); datas sempre da data do evento.

CREATE OR REPLACE FUNCTION public.enforce_event_carousel_banner_event_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_date DATE;
BEGIN
  SELECT COALESCE(e.event_date, e.date)
  INTO v_event_date
  FROM public.events e
  WHERE e.id = NEW.event_id;

  IF v_event_date IS NULL THEN
    RAISE EXCEPTION 'O evento selecionado não possui data definida para o banner.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.start_date := v_event_date;
    NEW.end_date := v_event_date;
    RETURN NEW;
  END IF;

  -- UPDATE: início sempre = data do evento; fim pode ser antecipado (encerrar exibição).
  NEW.start_date := v_event_date;

  IF NEW.end_date IS NULL OR NEW.end_date > v_event_date THEN
    NEW.end_date := v_event_date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_carousel_banner_dates ON public.event_carousel_banners;
CREATE TRIGGER trg_enforce_event_carousel_banner_dates
  BEFORE INSERT OR UPDATE OF event_id, start_date, end_date
  ON public.event_carousel_banners
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_carousel_banner_event_dates();

COMMENT ON FUNCTION public.enforce_event_carousel_banner_event_dates() IS
  'Banner carrossel: start/end = data do evento no INSERT; UPDATE permite end anterior (encerrar).';

-- Regra antiga (vários banners ativos) substituída pelo UNIQUE em event_id.
DROP TRIGGER IF EXISTS trg_single_active_event_carousel_banner ON public.event_carousel_banners;
DROP FUNCTION IF EXISTS public.assert_single_active_event_carousel_banner();
