-- gen_random_bytes vive em extensions (pgcrypto).
-- finalize_client_credit_consumption_payment tinha search_path=public e falhava ao gerar EFDEL.*.

ALTER FUNCTION public.finalize_client_credit_consumption_payment(UUID, UUID, TEXT)
  SET search_path = public, extensions;
