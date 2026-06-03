-- Regra: no máximo 1 banner ativo por evento no carrossel (todos os planos).

CREATE OR REPLACE FUNCTION public.event_carousel_banner_is_active(
  p_start_date DATE,
  p_end_date DATE,
  p_reference_date DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_start_date IS NOT NULL
     AND p_end_date IS NOT NULL
     AND p_start_date <= p_reference_date
     AND p_end_date >= p_reference_date;
$$;

CREATE OR REPLACE FUNCTION public.assert_single_active_event_carousel_banner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_will_be_active BOOLEAN;
BEGIN
  v_will_be_active := public.event_carousel_banner_is_active(NEW.start_date, NEW.end_date);

  IF NOT v_will_be_active THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_carousel_banners b
    WHERE b.event_id = NEW.event_id
      AND b.id IS DISTINCT FROM NEW.id
      AND public.event_carousel_banner_is_active(b.start_date, b.end_date)
  ) THEN
    RAISE EXCEPTION
      'Este evento já possui um banner ativo no carrossel. Encerre o banner atual ou aguarde o fim da exibição para criar outro.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_active_event_carousel_banner ON public.event_carousel_banners;

CREATE TRIGGER trg_single_active_event_carousel_banner
  BEFORE INSERT OR UPDATE OF event_id, start_date, end_date
  ON public.event_carousel_banners
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_single_active_event_carousel_banner();

COMMENT ON FUNCTION public.event_carousel_banner_is_active(DATE, DATE, DATE) IS
  'Banner de evento ativo quando a data de referência está entre start_date e end_date (inclusive).';
