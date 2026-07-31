-- Vazamento de dados confirmado em producao: as tres views de relatorio nasceram
-- sem `security_invoker`, entao rodavam como postgres e ignoravam o RLS das
-- tabelas base. Como o Supabase tambem concede SELECT a anon por default
-- privilege, qualquer pessoa com a chave publica (que vai no bundle do browser)
-- lia via /rest/v1/<view>:
--   * sales_reports_view  -> faturamento de todos os eventos de todas as empresas
--   * events_reports_view -> ocupacao e dados de evento de todas as empresas
--   * wristband_analytics_with_profile_details -> nome, e-mail e CPF dos
--     compradores/inscritos da plataforma inteira (join com auth.users)

-- 1) As duas views de relatorio nao sao usadas por nenhum codigo do app: o
-- relatorio foi reescrito em codigo (ver docs/PLANO_ACAO_RELATORIOS_E_ETIQUETAS).
-- Nada depende delas no banco. Manter so aumentaria a superficie exposta.
DROP VIEW IF EXISTS public.sales_reports_view;
DROP VIEW IF EXISTS public.events_reports_view;

-- 2) Esta continua em uso (use-event-ticket-analytics). Precisa do privilegio do
-- owner para ler auth.users, entao nao da para trocar por security_invoker sem
-- quebrar o join. A autorizacao passa a ser explicita dentro da propria view,
-- espelhando as policies ja existentes em wristband_analytics: Admin Master,
-- gestor da empresa dona da pulseira, ou o proprio titular do ingresso.
DROP VIEW IF EXISTS public.wristband_analytics_with_profile_details;

CREATE VIEW public.wristband_analytics_with_profile_details AS
SELECT
  wa.id,
  wa.wristband_id,
  w.event_id,
  w.code AS wristband_code,
  w.price AS wristband_price,
  w.access_type AS wristband_access_type,
  wa.event_type,
  wa.event_data,
  wa.created_at,
  wa.client_user_id,
  wa.code_wristbands,
  wa.status AS analytics_status,
  wa.sequential_number,
  p.first_name,
  p.last_name,
  u.email AS client_email
FROM public.wristband_analytics wa
JOIN public.wristbands w ON w.id = wa.wristband_id
LEFT JOIN auth.users u ON u.id = wa.client_user_id
LEFT JOIN public.profiles p ON p.id = u.id
WHERE
  public.user_is_admin_master_for_rls()
  OR wa.client_user_id = auth.uid()
  OR w.company_id IN (
    SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()
  );

-- Sem sessao nao ha o que ver: as tres condicoes dependem de auth.uid().
-- Revogar anon evita que a view volte a responder caso alguem afrouxe o filtro.
REVOKE ALL ON public.wristband_analytics_with_profile_details FROM PUBLIC, anon;
GRANT SELECT ON public.wristband_analytics_with_profile_details TO authenticated, service_role;

COMMENT ON VIEW public.wristband_analytics_with_profile_details IS
  'Ingressos com dados do titular. Filtra por Admin Master, gestor da empresa ou proprio titular — nao expor a anon.';
