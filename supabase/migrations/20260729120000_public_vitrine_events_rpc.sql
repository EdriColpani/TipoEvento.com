-- Catálogo público da vitrine: independente do papel (gestor/admin não devem ver lista vazia na home).
-- SECURITY DEFINER evita conflito com RLS events_select_gestor_own / events_select_admin_master.

CREATE OR REPLACE FUNCTION public.get_public_vitrine_events()
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  date date,
  event_time time without time zone,
  location text,
  exposure_card_image_url text,
  category text,
  capacity integer,
  is_paid boolean,
  listing_only boolean,
  ticket_price numeric,
  is_active boolean,
  inventory_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.title,
    e.description,
    e.date,
    e.time AS event_time,
    e.location,
    e.exposure_card_image_url,
    e.category,
    e.capacity,
    COALESCE(e.is_paid, false),
    COALESCE(e.listing_only, false),
    e.ticket_price,
    COALESCE(e.is_active, false),
    e.inventory_mode
  FROM public.events e
  WHERE COALESCE(e.is_active, false) = true
  ORDER BY e.date ASC, e.time ASC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.get_public_vitrine_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_vitrine_events() TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_vitrine_events() IS
  'Lista eventos ativos da vitrine pública. Usado pela home — não depende do RLS por papel do usuário.';
