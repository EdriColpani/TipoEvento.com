-- Coluna para marcar presença/confirmado nas inscrições

ALTER TABLE event_registrations
    ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT FALSE;

