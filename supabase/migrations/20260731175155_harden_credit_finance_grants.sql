-- Hardening de crédito: as RPCs financeiras SECURITY DEFINER nasceram com EXECUTE
-- para anon/authenticated pelo default privilege do Supabase. Como elas não
-- consultam o MP nem exigem auth.uid() de verdade, qualquer portador da anon key
-- podia creditar saldo, gastar carteira de terceiros, reverter consumo ou dar
-- baixa em repasse. O caminho legítimo é sempre Edge Function + service_role
-- (exceto credit_spend_ticket_purchase, que usa o JWT do comprador de propósito).

-- 1) Escrita financeira: só service_role
REVOKE ALL ON FUNCTION public.credit_topup_settle(UUID, TEXT, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_topup_settle(UUID, TEXT, NUMERIC, NUMERIC, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.credit_spend_consumption(UUID, UUID, JSONB, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_spend_consumption(UUID, UUID, JSONB, TEXT, UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.rollback_credit_spend(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_credit_spend(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.credit_topup_handle_mp_chargeback(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_topup_handle_mp_chargeback(UUID, TEXT, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.credit_refund_to_wallet(UUID, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon;
-- Admin Master chama pelo browser (callRpcRest); a própria função exige user_is_admin_master_for_rls().
GRANT EXECUTE ON FUNCTION public.credit_refund_to_wallet(UUID, NUMERIC, TEXT, TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_credit_mp_disbursement(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_credit_mp_disbursement(UUID, TEXT, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_credit_disbursement_failed(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_credit_disbursement_failed(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_credit_topup_chargeback_admin_notified(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_credit_topup_chargeback_admin_notified(UUID, TEXT, TEXT)
  TO service_role;

-- 2) Baixa de repasse: só service_role (Admin Master via edge/RPC admin)
REVOKE ALL ON FUNCTION public.execute_manager_credit_payout(UUID, UUID[], UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_manager_credit_payout(UUID, UUID[], UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- 3) Overload antigo de 4 args: o gestor (ou qualquer um passando o UUID dele)
-- conseguia marcar o próprio repasse como pago. A assinatura vigente é a de 7 args.
DROP FUNCTION IF EXISTS public.execute_manager_credit_payout(UUID, UUID[], UUID, TEXT);

-- 4) Compra de ingresso com crédito: o edge function chama com o JWT do cliente
-- (supabaseAnon + Authorization), então authenticated precisa continuar.
-- anon não precisa — PostgREST sem sessão não deve debitar.
REVOKE ALL ON FUNCTION public.credit_spend_ticket_purchase(UUID, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_spend_ticket_purchase(UUID, JSONB, TEXT, TEXT)
  TO authenticated, service_role;
