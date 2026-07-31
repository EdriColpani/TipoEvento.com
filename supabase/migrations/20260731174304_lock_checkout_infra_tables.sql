-- Tabelas de infraestrutura do checkout ficavam graváveis por anon via PostgREST:
-- dava para zerar o rate limit do checkout e falsear a disponibilidade exibida.
-- Todo acesso legítimo passa por funções SECURITY DEFINER, então basta fechar a porta.

ALTER TABLE public.checkout_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_availability_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_rate_limit_buckets FROM anon, authenticated;
REVOKE ALL ON TABLE public.event_availability_cache FROM anon, authenticated;
