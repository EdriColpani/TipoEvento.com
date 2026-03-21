-- Contratos inseridos com '\n' dentro de string SQL com aspas simples (sem prefixo E'...')
-- armazenam dois caracteres (backslash + "n"), não quebra de linha. Corrige dados legados.
UPDATE public.event_contracts
SET content = replace(content, E'\\n', E'\n')
WHERE position(E'\\n' IN content) > 0;
