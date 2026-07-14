-- Relatórios, notificações e aditivo contratual — chargeback de ingresso

CREATE OR REPLACE FUNCTION public.get_admin_ticket_chargeback_summary(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_cases INTEGER := 0;
  v_total_manager NUMERIC(14, 2) := 0;
  v_total_platform NUMERIC(14, 2) := 0;
  v_open_debt NUMERIC(14, 2) := 0;
  v_manual_review INTEGER := 0;
  v_last_at TIMESTAMPTZ;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(c.manager_net_amount), 0),
    COALESCE(SUM(c.platform_fee_amount), 0),
    COUNT(*) FILTER (WHERE c.needs_manual_review)::integer,
    MAX(c.created_at)
  INTO
    v_total_cases,
    v_total_manager,
    v_total_platform,
    v_manual_review,
    v_last_at
  FROM public.ticket_chargeback_cases c
  WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR c.created_at::date <= p_end_date);

  SELECT COALESCE(SUM(d.amount_due - d.amount_applied), 0)
  INTO v_open_debt
  FROM public.manager_ticket_chargeback_debt d
  WHERE d.status IN ('open', 'partial');

  RETURN jsonb_build_object(
    'total_cases', v_total_cases,
    'total_manager_net', round(v_total_manager, 2),
    'total_platform_fee', round(v_total_platform, 2),
    'open_debt_remaining', round(v_open_debt, 2),
    'needs_manual_review_count', v_manual_review,
    'last_chargeback_at', v_last_at,
    'has_open_debt_alert', v_open_debt > 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_ticket_chargebacks(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_open_debt_only BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_total INTEGER := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_total
  FROM public.ticket_chargeback_cases c
  LEFT JOIN public.manager_ticket_chargeback_debt d ON d.chargeback_case_id = c.id
  WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
    AND (
      NOT COALESCE(p_open_debt_only, false)
      OR (d.status IN ('open', 'partial') AND (d.amount_due - d.amount_applied) > 0)
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.receivable_id,
      c.event_id,
      c.company_id,
      c.client_user_id,
      c.manager_user_id,
      c.mp_payment_id,
      c.mp_status,
      c.gross_amount,
      c.platform_fee_amount,
      c.manager_net_amount,
      c.tickets_cancelled_count,
      c.already_checked_in,
      c.needs_manual_review,
      c.reason,
      c.created_at,
      c.manager_notified_at,
      c.admin_notified_at,
      e.title AS event_title,
      co.corporate_name AS company_name,
      d.id AS debt_id,
      d.status AS debt_status,
      d.amount_due AS debt_amount_due,
      d.amount_applied AS debt_amount_applied,
      round(COALESCE(d.amount_due, 0) - COALESCE(d.amount_applied, 0), 2) AS debt_remaining
    FROM public.ticket_chargeback_cases c
    LEFT JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    LEFT JOIN public.manager_ticket_chargeback_debt d ON d.chargeback_case_id = c.id
    WHERE (p_start_date IS NULL OR c.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR c.created_at::date <= p_end_date)
      AND (
        NOT COALESCE(p_open_debt_only, false)
        OR (d.status IN ('open', 'partial') AND (d.amount_due - d.amount_applied) > 0)
      )
    ORDER BY c.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manager_ticket_chargeback_debts(
  p_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF p_company_id IS NOT NULL THEN
    IF NOT (
      public.user_is_admin_master_for_rls()
      OR public.user_owns_company(p_company_id, auth.uid())
    ) THEN
      RAISE EXCEPTION 'Sem permissão.';
    END IF;
  ELSIF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Informe a empresa.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      d.id,
      d.chargeback_case_id,
      d.company_id,
      d.amount_due,
      d.amount_applied,
      round(d.amount_due - d.amount_applied, 2) AS amount_remaining,
      d.status,
      d.created_at,
      c.mp_payment_id,
      c.event_id,
      e.title AS event_title,
      c.manager_net_amount,
      c.reason
    FROM public.manager_ticket_chargeback_debt d
    INNER JOIN public.ticket_chargeback_cases c ON c.id = d.chargeback_case_id
    LEFT JOIN public.events e ON e.id = c.event_id
    WHERE (p_company_id IS NULL OR d.company_id = p_company_id)
      AND (
        public.user_is_admin_master_for_rls()
        OR public.user_owns_company(d.company_id, auth.uid())
      )
    ORDER BY d.created_at DESC
    LIMIT 200
  ) t;

  RETURN jsonb_build_object('items', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_ticket_chargeback_notifications(
  p_limit INTEGER DEFAULT 50,
  p_chargeback_case_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.receivable_id,
      c.event_id,
      c.company_id,
      c.client_user_id,
      c.manager_user_id,
      c.mp_payment_id,
      c.mp_status,
      c.gross_amount,
      c.platform_fee_amount,
      c.manager_net_amount,
      c.tickets_cancelled_count,
      c.already_checked_in,
      c.needs_manual_review,
      c.reason,
      c.created_at,
      c.manager_notified_at,
      c.admin_notified_at,
      e.title AS event_title,
      co.corporate_name AS company_name,
      co.email AS company_email,
      mu.email AS manager_email,
      cu.email AS client_email
    FROM public.ticket_chargeback_cases c
    LEFT JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    LEFT JOIN auth.users mu ON mu.id = c.manager_user_id
    LEFT JOIN auth.users cu ON cu.id = c.client_user_id
    WHERE (p_chargeback_case_id IS NULL OR c.id = p_chargeback_case_id)
      AND (
        c.manager_notified_at IS NULL
        OR c.admin_notified_at IS NULL
      )
    ORDER BY c.created_at ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 100))
  ) t;

  RETURN jsonb_build_object('items', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ticket_chargeback_notified(
  p_case_id UUID,
  p_audience TEXT,
  p_resend_id TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audience TEXT;
  v_ok BOOLEAN;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Caso de chargeback inválido.';
  END IF;

  v_audience := lower(trim(COALESCE(p_audience, '')));
  IF v_audience NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'Audiência inválida.';
  END IF;

  v_ok := (p_error_message IS NULL OR trim(p_error_message) = '');

  IF v_audience = 'manager' THEN
    UPDATE public.ticket_chargeback_cases
    SET
      manager_notified_at = CASE WHEN v_ok THEN timezone('utc'::text, now()) ELSE manager_notified_at END,
      manager_notify_resend_id = CASE WHEN v_ok THEN NULLIF(trim(p_resend_id), '') ELSE manager_notify_resend_id END,
      manager_notify_error = NULLIF(left(trim(COALESCE(p_error_message, '')), 2000), '')
    WHERE id = p_case_id;
  ELSE
    UPDATE public.ticket_chargeback_cases
    SET
      admin_notified_at = CASE WHEN v_ok THEN timezone('utc'::text, now()) ELSE admin_notified_at END,
      admin_notify_resend_id = CASE WHEN v_ok THEN NULLIF(trim(p_resend_id), '') ELSE admin_notify_resend_id END,
      admin_notify_error = NULLIF(left(trim(COALESCE(p_error_message, '')), 2000), '')
    WHERE id = p_case_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso de chargeback não encontrado.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'case_id', p_case_id, 'audience', v_audience);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_ticket_chargeback_summary(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_admin_ticket_chargebacks(DATE, DATE, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_manager_ticket_chargeback_debts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_ticket_chargeback_notifications(INTEGER, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_ticket_chargeback_notified(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_admin_ticket_chargeback_summary(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_ticket_chargebacks(DATE, DATE, BOOLEAN, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manager_ticket_chargeback_debts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_ticket_chargeback_notifications(INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_ticket_chargeback_notified(UUID, TEXT, TEXT, TEXT) TO service_role;

-- Aditivo contratual (ingresso chargeback + abatimento em repasses)
DO $apply$
DECLARE
  v_marker TEXT := 'data-eventfest-clause="ticket-chargeback-2026-07"';
  v_client_section TEXT;
  v_gestor_section TEXT;
  r JSONB;
BEGIN
  v_client_section := $html$
<section data-eventfest-clause="ticket-chargeback-2026-07">
<h3>Compra de ingressos — chargeback e invalidação</h3>
<p><strong>Última atualização do aditivo:</strong> julho de 2026.</p>
<p><strong>1. Pagamento.</strong> A compra de ingresso via Mercado Pago segue as regras do checkout e do emissor do meio de pagamento.</p>
<p><strong>2. Chargeback, estorno ou contestação.</strong> Se houver chargeback, estorno ou contestação sobre pagamento de ingresso já confirmado, a EventFest poderá invalidar o(s) ingresso(s) correspondente(s) na plataforma, independentemente de já ter sido utilizada a entrada no evento, e registrar a operação para auditoria.</p>
<p><strong>3. Efeitos.</strong> Ingresso invalidado não autoriza nova entrada pelo sistema de validação. Demais medidas cabíveis ao organizador ou à legislação aplicável permanecem reservadas.</p>
</section>
$html$;

  v_gestor_section := $html$
<section data-eventfest-clause="ticket-chargeback-2026-07">
<h3>Aditivo — chargeback em venda de ingressos e compensação em repasses</h3>
<p><strong>Última atualização do aditivo:</strong> julho de 2026.</p>
<p><strong>1. Fluxo normal inalterado.</strong> A venda de ingresso via Mercado Pago (coleta na conta do gestor e taxa/comissão EventFest) permanece nos termos operacionais já vigentes. Este aditivo disciplina apenas hipóteses de chargeback, estorno ou contestação após a confirmação do pagamento.</p>
<p><strong>2. Invalidação do ingresso.</strong> Em caso de chargeback/estorno/contestação no Mercado Pago sobre pagamento de ingresso já liquidado, a EventFest poderá cancelar/invalidar o ingresso no sistema, registrar auditoria e notificar a empresa.</p>
<p><strong>3. Compensação em repasses.</strong> A empresa autoriza a EventFest a registrar débito correspondente ao valor líquido atribuído à empresa na venda contestada e a <strong>descontar esse valor nos repasses futuros</strong> devidos na plataforma (incluindo liquidações de crédito D+1 e demais créditos a pagar à empresa), até a quitação do débito.</p>
<p><strong>4. Transparência.</strong> A plataforma manterá registro do caso (identificadores Mercado Pago, evento, valores e aplicações de desconto) e poderá enviar aviso por e-mail ao gestor/empresa.</p>
<p><strong>5. Aceite.</strong> A continuidade do uso da venda de ingressos após a publicação deste aditivo implica aceite das regras acima, sem prejuízo de reaceite formal quando exigido pela plataforma.</p>
</section>
$html$;

  r := public.apply_event_contract_amendment('client_terms', v_client_section, v_marker, false);
  RAISE NOTICE 'client_terms ticket chargeback: %', r;

  r := public.apply_event_contract_amendment('company_registration', v_gestor_section, v_marker, false);
  RAISE NOTICE 'company_registration ticket chargeback: %', r;

  r := public.apply_event_contract_amendment('ticket_commission', v_gestor_section, v_marker, true);
  RAISE NOTICE 'ticket_commission: %', r;

  r := public.apply_event_contract_amendment('ticket_plus_consumption', v_gestor_section, v_marker, true);
  RAISE NOTICE 'ticket_plus_consumption: %', r;
END
$apply$;
