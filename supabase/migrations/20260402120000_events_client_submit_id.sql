-- Idempotência no cadastro de evento: evita 2 linhas quando o front envia INSERT duplicado (mesma aba/sessão).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS client_submit_id UUID NULL;

COMMENT ON COLUMN public.events.client_submit_id IS
  'UUID enviado pelo app na criação; UNIQUE parcial impede segundo INSERT com o mesmo valor (mesma sessão de formulário).';

CREATE UNIQUE INDEX IF NOT EXISTS events_client_submit_id_unique
  ON public.events (client_submit_id)
  WHERE client_submit_id IS NOT NULL;
