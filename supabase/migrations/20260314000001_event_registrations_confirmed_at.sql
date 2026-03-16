-- Data e hora em que a presença foi confirmada no validador (dia do evento)

ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN event_registrations.confirmed_at IS 'Data e hora em que a presença foi confirmada na entrada (validador).';
