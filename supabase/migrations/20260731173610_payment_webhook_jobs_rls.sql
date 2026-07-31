-- A fila de webhooks fica no schema public e estava sem RLS nem policies, ou seja,
-- exposta via PostgREST. Um job forjado com payload "approved" vira ingresso emitido.
-- Sem policy nenhuma, só service_role (que ignora RLS) e as RPCs SECURITY DEFINER acessam.

ALTER TABLE public.payment_webhook_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_webhook_jobs FROM anon, authenticated;

COMMENT ON TABLE public.payment_webhook_jobs IS
  'Fila interna de notificacoes do Mercado Pago. Acesso exclusivo do backend (service_role).';
