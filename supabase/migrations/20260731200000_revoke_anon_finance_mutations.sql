-- O Supabase concede EXECUTE a anon/authenticated em toda funcao nova via
-- default privilege. Por isso "REVOKE ALL FROM PUBLIC" nao fecha nada: o grant
-- de anon e explicito. O resultado eram RPCs SECURITY DEFINER que movem dinheiro
-- e nao tem nenhuma checagem interna de papel, chamaveis por qualquer portador
-- da anon key em /rest/v1/rpc/<nome>. Exemplos do que era possivel:
--   * quitar cobranca de mensalidade/licenca sem pagar;
--   * forjar chargeback de ingresso (cancela ingresso e gera divida no gestor);
--   * criar repasse D+1 de dinheiro que nunca entrou;
--   * antecipar a liberacao de valores retidos.
-- Todas sao chamadas exclusivamente por Edge Function com service_role, ou por
-- trigger/cron — que executam como owner e nao dependem destes grants.

DO $$
DECLARE
  v_fn TEXT;
  v_proc RECORD;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'apply_ticket_chargeback_debts_to_payout',
    'assert_billing_plan_contract_match',
    'attach_credit_topup_mp_preference',
    'complete_consumption_license_charge_payment',
    'complete_listing_monthly_charge_payment',
    'complete_ticket_inactivity_charge_payment',
    'create_ticket_settlement_from_receivable',
    'ensure_client_credit_account',
    'mark_ticket_chargeback_notified',
    'process_credit_settlement_releases',
    'process_ticket_settlement_releases',
    'ticket_handle_mp_chargeback'
  ]
  LOOP
    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_proc.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc.sig);
    END LOOP;
  END LOOP;
END;
$$;

-- Estas duas tem guarda interna (user_is_admin_master_for_rls), mas o painel
-- admin as chama pelo browser, entao authenticated permanece. anon nao.
REVOKE ALL ON FUNCTION public.get_admin_commission_daily_series(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_commission_daily_series(DATE, DATE) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_backfill_missing_financial_splits(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_backfill_missing_financial_splits(UUID) TO authenticated, service_role;
