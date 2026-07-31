-- Segunda leva do mesmo problema de default privilege: funcoes SECURITY DEFINER
-- de LEITURA (STABLE) que nunca foram revogadas de anon e nao tem guarda interna.
-- A varredura anterior so cobriu as que escrevem. Confirmado em producao com a
-- chave publica:
--   * company_payout_bank_snapshot -> agencia, conta, chave PIX, CNPJ e titular
--     de QUALQUER empresa (basta o company_id, que e legivel em wristbands);
--   * get_admin_master_notification_emails -> e-mail do Admin Master;
--   * get_admin_master_user_ids -> UUID do Admin Master.
-- Nenhuma delas e usada em policy de RLS; os chamadores internos sao funcoes
-- SECURITY DEFINER do postgres, que nao dependem destes grants.

DO $$
DECLARE
  v_fn TEXT;
  v_proc RECORD;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'company_payout_bank_snapshot',
    'get_admin_master_notification_emails',
    'get_admin_master_user_ids',
    'get_pending_ticket_chargeback_notifications',
    'get_pending_credit_topup_chargeback_admin_notifications',
    'company_open_ticket_chargeback_stats',
    'get_credit_spend_disbursement_status',
    'retry_failed_credit_disbursements'
  ]
  LOOP
    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_proc.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc.sig);
    END LOOP;
  END LOOP;
END;
$$;

-- Totais de repasse da plataforma inteira. So a tela do Admin Master usa
-- (AdminCreditReports), entao ganha guarda propria em vez de perder o grant.
CREATE OR REPLACE FUNCTION public.get_ticket_manual_settlement_totals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master.';
  END IF;

  SELECT jsonb_build_object(
    'pending_retention', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'awaiting_payment', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0),
    'paid', COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN status = 'clawback' THEN manager_amount ELSE 0 END), 0)
  )
  INTO v_result
  FROM public.manager_ticket_settlement_ledger;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_manual_settlement_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ticket_manual_settlement_totals() TO authenticated, service_role;
