-- Atualiza textos de marca nos contratos já existentes (Mazoy -> EventoFest).
-- Idempotente: só altera linhas que ainda contenham "Mazoy".
UPDATE event_contracts
SET
  title = REPLACE(title, 'Mazoy', 'EventoFest'),
  content = REPLACE(content, 'Mazoy', 'EventoFest')
WHERE title LIKE '%Mazoy%' OR content LIKE '%Mazoy%';
