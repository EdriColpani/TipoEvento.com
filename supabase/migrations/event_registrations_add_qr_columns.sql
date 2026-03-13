-- Campos adicionais para inscrições: QR Code e controle de envio de e-mail/uso futuro

ALTER TABLE event_registrations
    ADD COLUMN IF NOT EXISTS qr_code TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS qr_used BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_event_registrations_qr_code ON event_registrations(qr_code);

