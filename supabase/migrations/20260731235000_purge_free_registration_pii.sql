-- Remocao do dado pessoal das inscricoes gratuitas.
-- Contexto: essas 34 linhas ficaram publicamente legiveis por tempo
-- indeterminado (policy USING (true) + chave anon no bundle). Sao de um unico
-- evento ja encerrado e inativo ("Oficina de Arduino - Basico", 28/03/2026) e o
-- fluxo de inscricao gratuita nao sera mais usado.
--
-- Nenhuma delas e referenciada em receivables nem tem client_user_id, entao
-- apagar cpf/email/full_name nao quebra vinculo financeiro nem de usuario.
-- Mantemos a linha (e portanto a contagem de inscritos no relatorio do gestor);
-- some apenas o dado pessoal, que e o que nao pode continuar armazenado.

UPDATE public.wristband_analytics
SET event_data = (event_data - 'cpf' - 'email' - 'full_name')
                 || jsonb_build_object('pii_removido_em', to_char(timezone('utc', now()), 'YYYY-MM-DD'))
WHERE event_type = 'free_registration'
  AND (event_data ? 'cpf' OR event_data ? 'email' OR event_data ? 'full_name');
