-- Remove referências legadas à marca Mazoy (todas as grafias) nos contratos.
-- Idempotente: só altera linhas que ainda contenham "mazoy".

UPDATE public.event_contracts
SET
  title = REPLACE(REPLACE(REPLACE(title, 'MAZOY', 'EventFest'), 'Mazoy', 'EventFest'), 'mazoy', 'EventFest'),
  content = REPLACE(REPLACE(REPLACE(content, 'MAZOY', 'EventFest'), 'Mazoy', 'EventFest'), 'mazoy', 'EventFest')
WHERE title ILIKE '%mazoy%' OR content ILIKE '%mazoy%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'terms_and_conditions'
  ) THEN
    UPDATE public.terms_and_conditions
    SET content = REPLACE(REPLACE(REPLACE(content, 'MAZOY', 'EventFest'), 'Mazoy', 'EventFest'), 'mazoy', 'EventFest')
    WHERE content ILIKE '%mazoy%';
  END IF;
END $$;
