-- Coordenadas do endereço do evento (Google Places / mapa na vitrine)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS address_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS address_lng double precision NULL,
  ADD COLUMN IF NOT EXISTS address_place_id text NULL;

COMMENT ON COLUMN public.events.address_lat IS 'Latitude do endereço (Google Places).';
COMMENT ON COLUMN public.events.address_lng IS 'Longitude do endereço (Google Places).';
COMMENT ON COLUMN public.events.address_place_id IS 'Google Place ID do endereço.';
