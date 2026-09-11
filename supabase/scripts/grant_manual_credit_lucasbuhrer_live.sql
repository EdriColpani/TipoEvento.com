-- =============================================================================
-- Recarga manual de crédito (restauração pós-limpeza de massa de teste)
-- Cliente: lucasbuhrer@live.com
-- Valor: R$ 10,00
--
-- Idempotente: se o mp_payment_id manual já existir como paid, não credita de novo.
-- Uso (SQL Editor / psql / MCP execute_sql):
--   \\i supabase/scripts/grant_manual_credit_lucasbuhrer_live.sql
-- =============================================================================

DO $$
DECLARE
  v_email TEXT := 'lucasbuhrer@live.com';
  v_amount NUMERIC(12, 2) := 10.00;
  v_mp_payment_id TEXT := 'manual-restore:lucasbuhrer@live.com:10.00:v1';
  v_user_id UUID;
  v_order_id UUID;
  v_existing_order public.credit_topup_orders%ROWTYPE;
  v_commission_pct NUMERIC(5, 2);
  v_settle JSONB;
  v_balance NUMERIC(12, 2);
  v_lot_remaining NUMERIC(12, 2);
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado: %', v_email;
  END IF;

  SELECT * INTO v_existing_order
  FROM public.credit_topup_orders
  WHERE mp_payment_id = v_mp_payment_id
  LIMIT 1;

  IF v_existing_order.id IS NOT NULL THEN
    SELECT balance_cached INTO v_balance
    FROM public.client_credit_accounts
    WHERE user_id = v_user_id;

    RAISE NOTICE 'Já aplicado anteriormente. order_id=% balance=%',
      v_existing_order.id, COALESCE(v_balance, 0);
    RETURN;
  END IF;

  PERFORM public.ensure_client_credit_account(v_user_id);
  v_commission_pct := public.get_credit_consumption_commission_pct();

  INSERT INTO public.credit_topup_orders (
    client_user_id,
    origin_company_id,
    origin_event_id,
    gross_paid_amount,
    credit_granted_amount,
    mp_fee_amount,
    net_cash_received,
    consumption_commission_pct_snapshot,
    fee_validation_ok,
    status,
    settlement_funding_type,
    mp_payment_type_id,
    mp_payment_method_id,
    public_description,
    internal_description
  ) VALUES (
    v_user_id,
    NULL,
    NULL,
    v_amount,
    v_amount,
    0,
    v_amount,
    v_commission_pct,
    true,
    'pending',
    'pix',
    'bank_transfer',
    'pix',
    format('Recarga manual R$ %s (restauração colaborador)', to_char(v_amount, 'FM999999990.00')),
    'Script grant_manual_credit_lucasbuhrer_live.sql — crédito de teste restaurado após limpeza do banco'
  )
  RETURNING id INTO v_order_id;

  -- Liquidação oficial: ledger + balance + liability + funding lot (FIFO)
  v_settle := public.credit_topup_settle(
    v_order_id,
    v_mp_payment_id,
    0,              -- mp_fee
    v_amount,       -- net cash
    'approved',
    'bank_transfer',
    'pix',
    timezone('utc'::text, now()), -- release imediato (PIX)
    'pix'
  );

  IF NOT COALESCE((v_settle->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'Falha ao liquidar topup manual: %', v_settle;
  END IF;

  SELECT balance_cached INTO v_balance
  FROM public.client_credit_accounts
  WHERE user_id = v_user_id;

  SELECT COALESCE(SUM(remaining_amount), 0) INTO v_lot_remaining
  FROM public.credit_wallet_funding_lots
  WHERE client_user_id = v_user_id;

  RAISE NOTICE 'OK user=% order=% settle=% balance=% lots_remaining=%',
    v_user_id, v_order_id, v_settle, v_balance, v_lot_remaining;
END $$;

-- Conferência
SELECT
  u.email,
  a.balance_cached,
  a.status,
  a.version,
  (
    SELECT COALESCE(SUM(l.remaining_amount), 0)
    FROM public.credit_wallet_funding_lots l
    WHERE l.client_user_id = u.id
  ) AS lots_remaining,
  (
    SELECT COUNT(*)
    FROM public.credit_topup_orders t
    WHERE t.client_user_id = u.id AND t.status = 'paid'
  ) AS paid_topups
FROM auth.users u
LEFT JOIN public.client_credit_accounts a ON a.user_id = u.id
WHERE lower(u.email) = 'lucasbuhrer@live.com';
