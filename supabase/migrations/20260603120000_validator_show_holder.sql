-- Fase 5: exibir titular na portaria; suporte à revogação manual (versão já existe)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS validator_show_holder boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.validator_show_holder IS
  'Quando true, o validador exibe nome e CPF parcial do titular após leitura bem-sucedida (entrada).';
