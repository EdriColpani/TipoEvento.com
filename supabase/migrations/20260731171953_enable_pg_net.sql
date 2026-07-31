-- pg_net nunca havia sido habilitado, então todo cron que dispara Edge Function
-- (notificação de chargeback, drenagem da fila de webhooks) saía pelo caminho
-- "pg_net indisponível" e não fazia nada.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
