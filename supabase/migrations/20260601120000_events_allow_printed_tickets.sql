-- Permite ingresso impresso (QR/código fixo) além do QR dinâmico no app
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS allow_printed_tickets boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.allow_printed_tickets IS
  'Quando true, compras podem validar na portaria via QR fixo (UUID/código impresso) além do QR dinâmico do app. Quando false, apenas QR dinâmico EF1 no app.';
