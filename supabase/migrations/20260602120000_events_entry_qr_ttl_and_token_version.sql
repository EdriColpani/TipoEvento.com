-- TTL do QR dinâmico (EF1) por evento e versão para revogar tokens antigos
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS entry_qr_ttl_seconds integer NOT NULL DEFAULT 90;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_entry_qr_ttl_seconds_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_entry_qr_ttl_seconds_check
  CHECK (entry_qr_ttl_seconds IN (60, 90, 120));

COMMENT ON COLUMN public.events.entry_qr_ttl_seconds IS
  'Validade do QR dinâmico EF1 no app (segundos): 60, 90 ou 120.';

ALTER TABLE public.wristband_analytics
  ADD COLUMN IF NOT EXISTS entry_token_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.wristband_analytics.entry_token_version IS
  'Incrementado ao usar/revogar ingresso; tokens EF1 com ver menor são rejeitados.';
