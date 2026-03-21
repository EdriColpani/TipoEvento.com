-- Adiciona a coluna contract_type à tabela event_contracts

ALTER TABLE public.event_contracts
ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'other';

-- Atualiza os contratos existentes para o tipo 'event_terms'
-- Onde contract_type ainda é 'other' (o valor default)
UPDATE public.event_contracts
SET contract_type = 'event_terms'
WHERE contract_type = 'other';
