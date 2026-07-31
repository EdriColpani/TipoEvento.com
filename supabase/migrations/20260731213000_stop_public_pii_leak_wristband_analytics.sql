-- A policy "Permitir leitura de wristband_analytics" era SELECT para o papel
-- public com USING (true), ou seja, qualquer portador da chave anon (que vai no
-- bundle do browser) baixava a tabela inteira por /rest/v1/wristband_analytics.
-- As linhas de event_type = 'free_registration' guardam cpf, email e full_name
-- do inscrito dentro de event_data — vazamento de dado pessoal confirmado em
-- producao.
--
-- Corte minimo: o PII esta apenas nesse event_type. As linhas 'creation'
-- (inventario, sem PII) e 'purchase' (sem PII em event_data) seguem legiveis,
-- preservando as telas e hooks que ja liam a tabela. As de inscricao passam a
-- depender das policies que ja existem: Admin Master, gestor da empresa dona da
-- pulseira, ou o proprio titular.

DROP POLICY IF EXISTS "Permitir leitura de wristband_analytics" ON public.wristband_analytics;

CREATE POLICY "wristband_analytics_select_non_pii"
  ON public.wristband_analytics
  FOR SELECT
  USING (event_type IS DISTINCT FROM 'free_registration');
