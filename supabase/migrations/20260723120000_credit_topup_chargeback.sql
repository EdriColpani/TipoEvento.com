-- Fase 2: chargeback/refund em recarga de crédito (Mercado Pago)
-- 1) Debitar saldo do cliente (até credit_granted)
-- 2) Clawback proporcional em settlements de spends financiados pela recarga (FIFO)
-- 3) EventFest absorve o restante (platform_absorb)

CREATE TABLE IF NOT EXISTS public.credit_topup_chargeback_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topup_order_id UUID NOT NULL REFERENCES public.credit_topup_orders(id) ON DELETE RESTRICT,
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  mp_payment_id TEXT NOT NULL,
  mp_status TEXT NOT NULL,
  credit_granted_amount NUMERIC(12, 2) NOT NULL,
  wallet_debit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  clawback_manager_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  platform_absorb NUMERIC(12, 2) NOT NULL DEFAULT 0,
  clawback_settlement_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  ledger_entry_id UUID REFERENCES public.credit_ledger_entries(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT credit_topup_chargeback_mp_payment_unique UNIQUE (mp_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_topup_chargeback_client
  ON public.credit_topup_chargeback_cases(client_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_topup_chargeback_topup
  ON public.credit_topup_chargeback_cases(topup_order_id);

ALTER TABLE public.credit_topup_chargeback_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_topup_chargeback_admin ON public.credit_topup_chargeback_cases;
CREATE POLICY credit_topup_chargeback_admin
  ON public.credit_topup_chargeback_cases FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

GRANT SELECT ON public.credit_topup_chargeback_cases TO authenticated;

CREATE OR REPLACE FUNCTION public.credit_topup_handle_mp_chargeback(
  p_topup_order_id UUID,
  p_mp_payment_id TEXT,
  p_mp_status TEXT DEFAULT 'charged_back',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.credit_topup_orders%ROWTYPE;
  v_case_id UUID;
  v_account public.client_credit_accounts%ROWTYPE;
  v_recover NUMERIC(12, 2);
  v_wallet_debit NUMERIC(12, 2);
  v_new_balance NUMERIC(12, 2);
  v_clawback_total NUMERIC(12, 2) := 0;
  v_clawback_count INTEGER := 0;
  v_platform_absorb NUMERIC(12, 2);
  v_ledger_id UUID;
  v_idem TEXT;
  v_reason TEXT;
  v_desc TEXT;
  v_mp_status TEXT;
  rec RECORD;
  v_clawback_share NUMERIC(12, 2);
BEGIN
  IF p_topup_order_id IS NULL OR p_mp_payment_id IS NULL OR trim(p_mp_payment_id) = '' THEN
    RAISE EXCEPTION 'Parâmetros inválidos para chargeback de recarga.';
  END IF;

  v_mp_status := COALESCE(NULLIF(trim(p_mp_status), ''), 'charged_back');
  v_reason := COALESCE(
    NULLIF(trim(p_reason), ''),
    format('Chargeback Mercado Pago na recarga (%s).', v_mp_status)
  );
  v_idem := 'chargeback:' || trim(p_mp_payment_id);

  SELECT id INTO v_case_id
  FROM public.credit_topup_chargeback_cases
  WHERE idempotency_key = v_idem OR mp_payment_id = trim(p_mp_payment_id);

  IF v_case_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'chargeback_case_id', v_case_id);
  END IF;

  SELECT * INTO v_order
  FROM public.credit_topup_orders
  WHERE id = p_topup_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de recarga não encontrado.';
  END IF;

  IF v_order.status = 'refunded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'reason', 'already_refunded',
      'topup_order_id', v_order.id
    );
  END IF;

  IF v_order.status <> 'paid' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', true,
      'reason', 'not_paid',
      'status', v_order.status,
      'topup_order_id', v_order.id
    );
  END IF;

  IF v_order.mp_payment_id IS NOT NULL
     AND trim(v_order.mp_payment_id) <> trim(p_mp_payment_id) THEN
    RAISE EXCEPTION 'mp_payment_id não corresponde ao pedido de recarga.';
  END IF;

  v_recover := round(v_order.credit_granted_amount, 2);

  PERFORM public.ensure_client_credit_account(v_order.client_user_id);

  SELECT * INTO v_account
  FROM public.client_credit_accounts
  WHERE user_id = v_order.client_user_id
  FOR UPDATE;

  v_wallet_debit := round(LEAST(COALESCE(v_account.balance_cached, 0), v_recover), 2);
  v_new_balance := round(COALESCE(v_account.balance_cached, 0) - v_wallet_debit, 2);

  IF v_wallet_debit > 0 THEN
    v_desc := format(
      E'**Estorno por chargeback na recarga** — R$ %s debitados da sua carteira.\nMotivo: %s\nSaldo após operação: R$ %s.',
      to_char(v_wallet_debit, 'FM999999990.00'),
      v_reason,
      to_char(v_new_balance, 'FM999999990.00')
    );

    INSERT INTO public.credit_ledger_entries (
      account_user_id,
      entry_type,
      entry_subtype,
      amount,
      balance_after,
      idempotency_key,
      reference_type,
      reference_id,
      public_description,
      internal_description,
      metadata
    ) VALUES (
      v_order.client_user_id,
      'refund',
      'chargeback_debit',
      -v_wallet_debit,
      v_new_balance,
      v_idem,
      'credit_topup_order',
      v_order.id,
      v_desc,
      format('MP chargeback %s on topup %s', trim(p_mp_payment_id), v_order.id),
      jsonb_build_object(
        'mp_payment_id', trim(p_mp_payment_id),
        'mp_status', v_mp_status,
        'credit_granted_amount', v_recover,
        'wallet_debit', v_wallet_debit
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      UPDATE public.client_credit_accounts
      SET
        balance_cached = v_new_balance,
        version = version + 1,
        updated_at = timezone('utc'::text, now())
      WHERE user_id = v_order.client_user_id;
    ELSE
      SELECT balance_cached INTO v_new_balance
      FROM public.client_credit_accounts
      WHERE user_id = v_order.client_user_id;
      v_wallet_debit := 0;
    END IF;
  END IF;

  -- Clawback proporcional: spends atribuídos a esta recarga via FIFO de pool de crédito
  FOR rec IN
    WITH topup_pool AS (
      SELECT
        t.id,
        t.paid_at,
        t.credit_granted_amount,
        COALESCE(
          SUM(t.credit_granted_amount) OVER (
            ORDER BY t.paid_at, t.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0::numeric
        ) AS pool_start
      FROM public.credit_topup_orders t
      WHERE t.client_user_id = v_order.client_user_id
        AND t.status = 'paid'
    ),
    target AS (
      SELECT
        tp.pool_start,
        tp.pool_start + tp.credit_granted_amount AS pool_end
      FROM topup_pool tp
      WHERE tp.id = v_order.id
    ),
    spends AS (
      SELECT
        s.id AS spend_id,
        s.gross_amount,
        s.created_at,
        COALESCE(
          SUM(s.gross_amount) OVER (
            ORDER BY s.created_at, s.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0::numeric
        ) AS spend_start
      FROM public.credit_spend_orders s
      WHERE s.client_user_id = v_order.client_user_id
        AND s.status = 'completed'
    ),
    attributed AS (
      SELECT
        sp.spend_id,
        sp.gross_amount,
        sp.created_at,
        greatest(
          0::numeric,
          least(sp.spend_start + sp.gross_amount, tg.pool_end)
            - greatest(sp.spend_start, tg.pool_start)
        ) AS attributed_amount
      FROM spends sp
      CROSS JOIN target tg
    )
    SELECT
      a.spend_id,
      a.gross_amount,
      a.attributed_amount,
      a.created_at,
      m.id AS settlement_id,
      m.manager_amount
    FROM attributed a
    INNER JOIN public.manager_credit_settlement_ledger m
      ON m.spend_order_id = a.spend_id
    WHERE a.attributed_amount > 0
      AND m.status IN (
        'pending', 'pending_mp', 'released', 'paid', 'disbursed', 'disbursement_failed'
      )
    ORDER BY a.created_at ASC, m.id ASC
  LOOP
    v_clawback_share := round(
      rec.manager_amount * (rec.attributed_amount / NULLIF(rec.gross_amount, 0)),
      2
    );

    IF v_clawback_share <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.manager_credit_settlement_ledger
    SET
      status = 'clawback',
      clawback_reason = v_reason,
      updated_at = timezone('utc'::text, now())
    WHERE id = rec.settlement_id
      AND status IN (
        'pending', 'pending_mp', 'released', 'paid', 'disbursed', 'disbursement_failed'
      );

    IF FOUND THEN
      v_clawback_total := round(v_clawback_total + v_clawback_share, 2);
      v_clawback_count := v_clawback_count + 1;

      UPDATE public.credit_mp_disbursements d
      SET
        status = 'reversed',
        mp_error = left('Clawback chargeback recarga: ' || v_reason, 2000),
        updated_at = timezone('utc'::text, now())
      WHERE d.spend_order_id = rec.spend_id
        AND d.status IN ('pending', 'processing', 'failed', 'completed');
    END IF;
  END LOOP;

  v_platform_absorb := round(
    greatest(0, v_recover - v_wallet_debit - v_clawback_total),
    2
  );

  UPDATE public.platform_credit_liability
  SET
    outstanding_amount = greatest(0, outstanding_amount - v_recover),
    updated_at = timezone('utc'::text, now())
  WHERE id = 1;

  UPDATE public.credit_topup_orders
  SET
    status = 'refunded',
    mp_payment_id = COALESCE(mp_payment_id, trim(p_mp_payment_id)),
    internal_description = format('Chargeback MP %s (%s)', trim(p_mp_payment_id), v_mp_status),
    updated_at = timezone('utc'::text, now())
  WHERE id = v_order.id;

  INSERT INTO public.credit_topup_chargeback_cases (
    topup_order_id,
    client_user_id,
    mp_payment_id,
    mp_status,
    credit_granted_amount,
    wallet_debit,
    clawback_manager_total,
    platform_absorb,
    clawback_settlement_count,
    reason,
    ledger_entry_id,
    idempotency_key,
    metadata
  ) VALUES (
    v_order.id,
    v_order.client_user_id,
    trim(p_mp_payment_id),
    v_mp_status,
    v_recover,
    v_wallet_debit,
    v_clawback_total,
    v_platform_absorb,
    v_clawback_count,
    v_reason,
    v_ledger_id,
    v_idem,
    jsonb_build_object(
      'topup_order_id', v_order.id,
      'balance_after', v_new_balance,
      'gross_paid_amount', v_order.gross_paid_amount
    )
  )
  RETURNING id INTO v_case_id;

  IF v_ledger_id IS NOT NULL THEN
    UPDATE public.credit_ledger_entries
    SET reference_id = v_case_id
    WHERE id = v_ledger_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'chargeback_case_id', v_case_id,
    'topup_order_id', v_order.id,
    'credit_granted_amount', v_recover,
    'wallet_debit', v_wallet_debit,
    'clawback_manager_total', v_clawback_total,
    'platform_absorb', v_platform_absorb,
    'clawback_settlement_count', v_clawback_count,
    'balance', v_new_balance,
    'mp_status', v_mp_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.credit_topup_handle_mp_chargeback(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_topup_handle_mp_chargeback(UUID, TEXT, TEXT, TEXT) TO service_role;
