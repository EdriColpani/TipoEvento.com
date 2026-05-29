-- Destaques do evento (bullets na página pública): um item por linha no formulário do gestor.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS highlights text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.events.highlights IS
  'Lista curta de destaques para vitrine (ex.: open bar, atrações). Preenchido pelo gestor no cadastro/edição.';
