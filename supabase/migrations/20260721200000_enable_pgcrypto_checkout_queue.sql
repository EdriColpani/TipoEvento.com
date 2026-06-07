-- gen_random_bytes exige pgcrypto (tokens da fila virtual de checkout).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER FUNCTION public.join_event_checkout_queue(UUID, UUID)
  SET search_path = public, extensions;

ALTER FUNCTION public.poll_event_checkout_queue(TEXT)
  SET search_path = public, extensions;
