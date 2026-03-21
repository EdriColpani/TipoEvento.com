-- Altera a tabela event_contracts para ter unicidade de version por contract_type

-- 1. Remove a restrição UNIQUE antiga na coluna 'version'
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'event_contracts_version_key'
    ) THEN
        ALTER TABLE public.event_contracts DROP CONSTRAINT event_contracts_version_key;
    END IF;
END
$$;

-- 2. Adiciona um novo índice UNIQUE na combinação (version, contract_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_contracts_version_type_unique
ON public.event_contracts (version, contract_type);
