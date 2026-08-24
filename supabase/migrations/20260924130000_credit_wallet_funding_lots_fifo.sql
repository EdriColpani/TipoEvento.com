-- Fase 2+3: lotes de recarga + FIFO no gasto → release_at do gestor por origem do saldo.
-- Cliente usa na hora; gestor: PIX/débito D+1; cartão = money_release_date do lote ou D+30.
-- Só novos lançamentos (sem backfill de settlements antigos).

SELECT public.security_open_change_window('credit wallet funding lots fifo phase 2-3', 45);

-- ---------------------------------------------------------------------------
-- Lotes de funding (1 por top-up pago)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_wallet_funding_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topup_order_id UUID NOT NULL REFERENCES public.credit_topup_orders(id) ON DELETE RESTRICT,
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  original_amount NUMERIC(12, 2) NOT NULL CHECK (original_amount > 0),
  remaining_amount NUMERIC(12, 2) NOT NULL CHECK (remaining_amount >= 0),
  settlement_funding_type TEXT NOT NULL DEFAULT 'other'
    CHECK (settlement_funding_type IN ('credit_card', 'debit_card', 'pix', 'other')),
  mp_money_release_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT credit_wallet_funding_lots_remaining_lte_original
    CHECK (remaining_amount <= original_amount),
  CONSTRAINT credit_wallet_funding_lots_topup_unique UNIQUE (topup_order_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_wallet_funding_lots_fifo
  ON public.credit_wallet_funding_lots (client_user_id, paid_at, id)
  WHERE remaining_amount > 0;

COMMENT ON TABLE public.credit_wallet_funding_lots IS
  'Lotes de saldo por recarga; FIFO no spend define prazo de repasse ao gestor.';

-- ---------------------------------------------------------------------------
-- Alocações do spend → lotes (auditoria FIFO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_spend_funding_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spend_order_id UUID NOT NULL REFERENCES public.credit_spend_orders(id) ON DELETE RESTRICT,
  lot_id UUID REFERENCES public.credit_wallet_funding_lots(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  settlement_funding_type TEXT NOT NULL
    CHECK (settlement_funding_type IN ('credit_card', 'debit_card', 'pix', 'other')),
  mp_money_release_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  reversed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credit_spend_funding_alloc_spend
  ON public.credit_spend_funding_allocations (spend_order_id)
  WHERE reversed_at IS NULL;

COMMENT ON TABLE public.credit_spend_funding_allocations IS
  'Fatias FIFO do gasto por lote/origem; base para partir splits e release_at.';

-- ---------------------------------------------------------------------------
-- Colunas de meio nos splits e no ledger de crédito
-- ---------------------------------------------------------------------------
ALTER TABLE public.credit_financial_splits
  ADD COLUMN IF NOT EXISTS settlement_funding_type TEXT,
  ADD COLUMN IF NOT EXISTS mp_money_release_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS funding_allocation_id UUID
    REFERENCES public.credit_spend_funding_allocations(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_financial_splits_funding_type_check'
  ) THEN
    ALTER TABLE public.credit_financial_splits
      ADD CONSTRAINT credit_financial_splits_funding_type_check
      CHECK (
        settlement_funding_type IS NULL
        OR settlement_funding_type IN ('credit_card', 'debit_card', 'pix', 'other')
      );
  END IF;
END $$;

ALTER TABLE public.manager_credit_settlement_ledger
  ADD COLUMN IF NOT EXISTS settlement_funding_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_delay_days INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'manager_credit_settlement_funding_type_check'
  ) THEN
    ALTER TABLE public.manager_credit_settlement_ledger
      ADD CONSTRAINT manager_credit_settlement_funding_type_check
      CHECK (
        settlement_funding_type IS NULL
        OR settlement_funding_type IN ('credit_card', 'debit_card', 'pix', 'other')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.manager_credit_settlement_ledger.settlement_funding_type IS
  'Origem do saldo gasto (lote) que definiu o release_at.';

-- Alias semântico (mesma regra do ingresso)
CREATE OR REPLACE FUNCTION public.compute_credit_settlement_release_at(
  p_paid_at TIMESTAMPTZ,
  p_funding_type TEXT,
  p_money_release_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.compute_ticket_settlement_release_at(p_paid_at, p_funding_type, p_money_release_date);
$$;

-- ---------------------------------------------------------------------------
-- Criar / sincronizar lote a partir do top-up
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_credit_wallet_funding_lot_from_topup(
  p_topup_order_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.credit_topup_orders%ROWTYPE;
  v_lot_id UUID;
  v_funding TEXT;
  v_paid_at TIMESTAMPTZ;
BEGIN
  IF p_topup_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.credit_topup_orders
  WHERE id = p_topup_order_id;

  IF v_order.id IS NULL OR v_order.status <> 'paid' THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_order.credit_granted_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_funding := COALESCE(
    nullif(trim(v_order.settlement_funding_type), ''),
    public.normalize_mp_settlement_funding_type(v_order.mp_payment_type_id, v_order.mp_payment_method_id),
    'other'
  );
  v_paid_at := COALESCE(v_order.paid_at, timezone('utc'::text, now()));

  INSERT INTO public.credit_wallet_funding_lots (
    topup_order_id,
    client_user_id,
    original_amount,
    remaining_amount,
    settlement_funding_type,
    mp_money_release_date,
    paid_at
  ) VALUES (
    v_order.id,
    v_order.client_user_id,
    round(v_order.credit_granted_amount, 2),
    round(v_order.credit_granted_amount, 2),
    v_funding,
    v_order.mp_money_release_date,
    v_paid_at
  )
  ON CONFLICT (topup_order_id) DO UPDATE
  SET
    settlement_funding_type = EXCLUDED.settlement_funding_type,
    mp_money_release_date = COALESCE(EXCLUDED.mp_money_release_date, public.credit_wallet_funding_lots.mp_money_release_date),
    updated_at = timezone('utc'::text, now())
  RETURNING id INTO v_lot_id;

  RETURN v_lot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_credit_wallet_funding_lot_from_topup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' THEN
    PERFORM public.ensure_credit_wallet_funding_lot_from_topup(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_credit_wallet_funding_lot_from_topup ON public.credit_topup_orders;
CREATE TRIGGER trg_sync_credit_wallet_funding_lot_from_topup
  AFTER INSERT OR UPDATE OF status, settlement_funding_type, mp_money_release_date,
    mp_payment_type_id, mp_payment_method_id, credit_granted_amount, paid_at
  ON public.credit_topup_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_credit_wallet_funding_lot_from_topup();

-- ---------------------------------------------------------------------------
-- FIFO: alocar gasto nos lotes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_credit_spend_from_lots(
  p_client_user_id UUID,
  p_spend_order_id UUID,
  p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_need NUMERIC(12, 2) := round(COALESCE(p_amount, 0), 2);
  v_lot RECORD;
  v_take NUMERIC(12, 2);
  v_existing NUMERIC(12, 2);
BEGIN
  IF p_client_user_id IS NULL OR p_spend_order_id IS NULL OR v_need <= 0 THEN
    RAISE EXCEPTION 'Alocação FIFO inválida.';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_existing
  FROM public.credit_spend_funding_allocations
  WHERE spend_order_id = p_spend_order_id
    AND reversed_at IS NULL;

  IF v_existing >= v_need THEN
    RETURN;
  END IF;

  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Alocação FIFO parcial inconsistente para spend %.', p_spend_order_id;
  END IF;

  FOR v_lot IN
    SELECT id, remaining_amount, settlement_funding_type, mp_money_release_date
    FROM public.credit_wallet_funding_lots
    WHERE client_user_id = p_client_user_id
      AND remaining_amount > 0
    ORDER BY paid_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_need <= 0;
    v_take := LEAST(v_lot.remaining_amount, v_need);
    UPDATE public.credit_wallet_funding_lots
    SET
      remaining_amount = round(remaining_amount - v_take, 2),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_lot.id;

    INSERT INTO public.credit_spend_funding_allocations (
      spend_order_id,
      lot_id,
      amount,
      settlement_funding_type,
      mp_money_release_date
    ) VALUES (
      p_spend_order_id,
      v_lot.id,
      v_take,
      COALESCE(v_lot.settlement_funding_type, 'other'),
      v_lot.mp_money_release_date
    );

    v_need := round(v_need - v_take, 2);
  END LOOP;

  -- Saldo legado / sem lote: trata como other → D+1 (não bloqueia gasto de teste)
  IF v_need > 0 THEN
    INSERT INTO public.credit_spend_funding_allocations (
      spend_order_id,
      lot_id,
      amount,
      settlement_funding_type,
      mp_money_release_date
    ) VALUES (
      p_spend_order_id,
      NULL,
      v_need,
      'other',
      NULL
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_credit_spend_funding_allocations(
  p_spend_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT id, lot_id, amount
    FROM public.credit_spend_funding_allocations
    WHERE spend_order_id = p_spend_order_id
      AND reversed_at IS NULL
    ORDER BY created_at DESC, id DESC
    FOR UPDATE
  LOOP
    IF v_row.lot_id IS NOT NULL THEN
      UPDATE public.credit_wallet_funding_lots
      SET
        remaining_amount = round(remaining_amount + v_row.amount, 2),
        updated_at = timezone('utc'::text, now())
      WHERE id = v_row.lot_id;
    END IF;

    UPDATE public.credit_spend_funding_allocations
    SET reversed_at = timezone('utc'::text, now())
    WHERE id = v_row.id;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Inserir ledger de crédito com release_at por funding
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_manager_credit_settlement_for_split(
  p_split public.credit_financial_splits
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base TIMESTAMPTZ;
  v_funding TEXT;
  v_money_release TIMESTAMPTZ;
  v_release_at TIMESTAMPTZ;
  v_delay_days INTEGER;
BEGIN
  IF p_split.manager_amount IS NULL OR p_split.manager_amount <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(o.created_at, timezone('utc'::text, now()))
  INTO v_base
  FROM public.credit_spend_orders o
  WHERE o.id = p_split.spend_order_id;

  v_base := COALESCE(v_base, timezone('utc'::text, now()));
  v_funding := COALESCE(nullif(trim(p_split.settlement_funding_type), ''), 'other');
  v_money_release := p_split.mp_money_release_date;
  v_release_at := public.compute_credit_settlement_release_at(v_base, v_funding, v_money_release);

  IF v_funding = 'credit_card' AND v_money_release IS NOT NULL THEN
    v_delay_days := NULL;
  ELSIF v_funding = 'credit_card' THEN
    v_delay_days := 30;
  ELSE
    v_delay_days := 1;
  END IF;

  INSERT INTO public.manager_credit_settlement_ledger (
    company_id,
    spend_order_id,
    split_id,
    manager_amount,
    status,
    release_at,
    settlement_funding_type,
    settlement_delay_days
  ) VALUES (
    p_split.receiver_company_id,
    p_split.spend_order_id,
    p_split.id,
    p_split.manager_amount,
    'pending',
    v_release_at,
    v_funding,
    v_delay_days
  )
  ON CONFLICT (split_id) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: classifica funding (FIFO) e parte splits mistos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_settlement_from_split()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client UUID;
  v_pct NUMERIC(5, 2);
  v_alloc RECORD;
  v_allocs INTEGER := 0;
  v_idx INTEGER := 0;
  v_gross_left NUMERIC(12, 2);
  v_plat_left NUMERIC(12, 2);
  v_mgr_left NUMERIC(12, 2);
  v_slice_gross NUMERIC(12, 2);
  v_slice_plat NUMERIC(12, 2);
  v_slice_mgr NUMERIC(12, 2);
  v_first_id UUID;
  v_updated public.credit_financial_splits%ROWTYPE;
BEGIN
  IF NEW.manager_amount IS NULL OR NEW.manager_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Fatia já classificada (filha do remux) → só cria ledger
  IF NEW.settlement_funding_type IS NOT NULL THEN
    PERFORM public.insert_manager_credit_settlement_for_split(NEW);
    RETURN NEW;
  END IF;

  SELECT o.client_user_id, s.applied_percentage
  INTO v_client, v_pct
  FROM public.credit_spend_orders o
  CROSS JOIN (SELECT NEW.applied_percentage AS applied_percentage) s
  WHERE o.id = NEW.spend_order_id;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Spend order sem cliente para FIFO.';
  END IF;

  PERFORM public.allocate_credit_spend_from_lots(v_client, NEW.spend_order_id, NEW.gross_amount);

  SELECT COUNT(*)::integer
  INTO v_allocs
  FROM public.credit_spend_funding_allocations
  WHERE spend_order_id = NEW.spend_order_id
    AND reversed_at IS NULL;

  IF v_allocs = 0 THEN
    NEW.settlement_funding_type := 'other';
    UPDATE public.credit_financial_splits
    SET settlement_funding_type = 'other'
    WHERE id = NEW.id;
    SELECT * INTO v_updated FROM public.credit_financial_splits WHERE id = NEW.id;
    PERFORM public.insert_manager_credit_settlement_for_split(v_updated);
    RETURN NEW;
  END IF;

  v_gross_left := round(NEW.gross_amount, 2);
  v_plat_left := round(NEW.platform_amount, 2);
  v_mgr_left := round(NEW.manager_amount, 2);
  v_first_id := NEW.id;

  FOR v_alloc IN
    SELECT a.id, a.amount, a.settlement_funding_type, a.mp_money_release_date
    FROM public.credit_spend_funding_allocations a
    WHERE a.spend_order_id = NEW.spend_order_id
      AND a.reversed_at IS NULL
    ORDER BY a.created_at ASC, a.id ASC
  LOOP
    v_idx := v_idx + 1;

    IF v_idx = v_allocs THEN
      v_slice_gross := v_gross_left;
      v_slice_plat := v_plat_left;
      v_slice_mgr := v_mgr_left;
    ELSE
      v_slice_gross := round(v_alloc.amount, 2);
      v_slice_plat := round(v_slice_gross * (COALESCE(v_pct, 0) / 100.0), 2);
      v_slice_mgr := round(v_slice_gross - v_slice_plat, 2);
      v_gross_left := round(v_gross_left - v_slice_gross, 2);
      v_plat_left := round(v_plat_left - v_slice_plat, 2);
      v_mgr_left := round(v_mgr_left - v_slice_mgr, 2);
    END IF;

    IF v_idx = 1 THEN
      UPDATE public.credit_financial_splits
      SET
        gross_amount = v_slice_gross,
        platform_amount = v_slice_plat,
        manager_amount = v_slice_mgr,
        settlement_funding_type = v_alloc.settlement_funding_type,
        mp_money_release_date = v_alloc.mp_money_release_date,
        funding_allocation_id = v_alloc.id
      WHERE id = v_first_id;

      SELECT * INTO v_updated FROM public.credit_financial_splits WHERE id = v_first_id;
      PERFORM public.insert_manager_credit_settlement_for_split(v_updated);
    ELSE
      IF v_slice_mgr > 0 THEN
        INSERT INTO public.credit_financial_splits (
          spend_order_id,
          receiver_company_id,
          gross_amount,
          platform_amount,
          manager_amount,
          applied_percentage,
          settlement_funding_type,
          mp_money_release_date,
          funding_allocation_id
        ) VALUES (
          NEW.spend_order_id,
          NEW.receiver_company_id,
          v_slice_gross,
          v_slice_plat,
          v_slice_mgr,
          NEW.applied_percentage,
          v_alloc.settlement_funding_type,
          v_alloc.mp_money_release_date,
          v_alloc.id
        );
        -- Trigger recursivo cria o ledger da fatia filha
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- credit_topup_settle: grava meio + cria lote na mesma transação
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_topup_settle(
  p_topup_order_id UUID,
  p_mp_payment_id TEXT,
  p_mp_fee_amount NUMERIC DEFAULT NULL,
  p_net_cash_received NUMERIC DEFAULT NULL,
  p_payment_status TEXT DEFAULT 'approved',
  p_mp_payment_type_id TEXT DEFAULT NULL,
  p_mp_payment_method_id TEXT DEFAULT NULL,
  p_mp_money_release_date TIMESTAMPTZ DEFAULT NULL,
  p_settlement_funding_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.credit_topup_orders%ROWTYPE;
  v_existing_mp TEXT;
  v_commission_pct NUMERIC(5, 2);
  v_mp_fee NUMERIC(12, 2);
  v_net NUMERIC(12, 2);
  v_mp_pct NUMERIC(7, 4);
  v_fee_ok BOOLEAN;
  v_account public.client_credit_accounts%ROWTYPE;
  v_new_balance NUMERIC(12, 2);
  v_desc TEXT;
  v_ledger_id UUID;
  v_idem TEXT;
  v_funding TEXT;
  v_lot_id UUID;
BEGIN
  IF p_topup_order_id IS NULL OR p_mp_payment_id IS NULL OR trim(p_mp_payment_id) = '' THEN
    RAISE EXCEPTION 'Parâmetros inválidos para liquidação.';
  END IF;

  SELECT mp_payment_id INTO v_existing_mp
  FROM public.credit_topup_orders
  WHERE mp_payment_id = p_mp_payment_id AND id IS DISTINCT FROM p_topup_order_id;

  IF v_existing_mp IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'message', 'Pagamento MP já processado.');
  END IF;

  SELECT * INTO v_order
  FROM public.credit_topup_orders
  WHERE id = p_topup_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de recarga não encontrado.';
  END IF;

  v_funding := COALESCE(
    nullif(trim(p_settlement_funding_type), ''),
    public.normalize_mp_settlement_funding_type(p_mp_payment_type_id, p_mp_payment_method_id),
    nullif(trim(v_order.settlement_funding_type), ''),
    public.normalize_mp_settlement_funding_type(v_order.mp_payment_type_id, v_order.mp_payment_method_id),
    'other'
  );

  IF v_order.status = 'paid' THEN
    UPDATE public.credit_topup_orders
    SET
      mp_payment_type_id = COALESCE(nullif(trim(p_mp_payment_type_id), ''), mp_payment_type_id),
      mp_payment_method_id = COALESCE(nullif(trim(p_mp_payment_method_id), ''), mp_payment_method_id),
      mp_money_release_date = COALESCE(p_mp_money_release_date, mp_money_release_date),
      settlement_funding_type = COALESCE(v_funding, settlement_funding_type),
      updated_at = timezone('utc'::text, now())
    WHERE id = p_topup_order_id;

    v_lot_id := public.ensure_credit_wallet_funding_lot_from_topup(p_topup_order_id);

    RETURN jsonb_build_object(
      'success', true,
      'already_paid', true,
      'order_id', v_order.id,
      'funding_lot_id', v_lot_id,
      'balance', (SELECT balance_cached FROM public.client_credit_accounts WHERE user_id = v_order.client_user_id)
    );
  END IF;

  IF p_payment_status IS DISTINCT FROM 'approved' AND p_payment_status IS DISTINCT FROM 'authorized' THEN
    UPDATE public.credit_topup_orders
    SET status = 'failed', updated_at = timezone('utc'::text, now())
    WHERE id = p_topup_order_id;
    RETURN jsonb_build_object('success', false, 'status', p_payment_status);
  END IF;

  v_commission_pct := COALESCE(v_order.consumption_commission_pct_snapshot, public.get_credit_consumption_commission_pct());
  v_mp_fee := round(COALESCE(p_mp_fee_amount, 0)::numeric, 2);
  v_net := round(
    COALESCE(p_net_cash_received, v_order.gross_paid_amount - v_mp_fee)::numeric,
    2
  );
  IF v_order.gross_paid_amount > 0 THEN
    v_mp_pct := round(v_mp_fee / v_order.gross_paid_amount, 4);
  ELSE
    v_mp_pct := 0;
  END IF;
  v_fee_ok := v_mp_fee <= round(v_order.gross_paid_amount * (v_commission_pct / 100.0), 2) + 0.01;

  v_desc := public.format_credit_topup_public_description(
    v_order.credit_granted_amount,
    v_order.id,
    timezone('utc'::text, now())
  );

  PERFORM public.ensure_client_credit_account(v_order.client_user_id);

  SELECT * INTO v_account
  FROM public.client_credit_accounts
  WHERE user_id = v_order.client_user_id
  FOR UPDATE;

  IF v_account.status <> 'active' THEN
    RAISE EXCEPTION 'Carteira do cliente não está ativa.';
  END IF;

  v_new_balance := round(v_account.balance_cached + v_order.credit_granted_amount, 2);
  v_idem := 'topup:' || p_mp_payment_id;

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    correlation_id,
    origin_company_id,
    origin_event_id,
    reference_type,
    reference_id,
    public_description,
    internal_description,
    gross_paid_amount,
    credit_granted_amount,
    mp_fee_amount,
    net_cash_received,
    metadata
  ) VALUES (
    v_order.client_user_id,
    'topup',
    'topup_credit',
    v_order.credit_granted_amount,
    v_new_balance,
    v_idem,
    v_order.id,
    v_order.origin_company_id,
    v_order.origin_event_id,
    'credit_topup_order',
    v_order.id,
    v_desc,
    format(
      'MP %s | taxa R$ %s | líquido caixa R$ %s | fee_validation=%s | funding=%s',
      p_mp_payment_id, v_mp_fee, v_net, v_fee_ok, v_funding
    ),
    v_order.gross_paid_amount,
    v_order.credit_granted_amount,
    v_mp_fee,
    v_net,
    jsonb_build_object(
      'mp_payment_id', p_mp_payment_id,
      'fee_validation_ok', v_fee_ok,
      'consumption_commission_pct', v_commission_pct,
      'settlement_funding_type', v_funding
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    SELECT balance_cached INTO v_new_balance
    FROM public.client_credit_accounts WHERE user_id = v_order.client_user_id;
  ELSE
    UPDATE public.client_credit_accounts
    SET
      balance_cached = v_new_balance,
      version = version + 1,
      updated_at = timezone('utc'::text, now())
    WHERE user_id = v_order.client_user_id;

    UPDATE public.platform_credit_liability
    SET
      outstanding_amount = outstanding_amount + v_order.credit_granted_amount,
      updated_at = timezone('utc'::text, now())
    WHERE id = 1;
  END IF;

  UPDATE public.credit_topup_orders
  SET
    status = 'paid',
    mp_payment_id = p_mp_payment_id,
    mp_fee_amount = v_mp_fee,
    net_cash_received = v_net,
    mp_fee_pct_snapshot = v_mp_pct,
    fee_validation_ok = v_fee_ok,
    public_description = v_desc,
    internal_description = format('Liquidação MP %s', p_mp_payment_id),
    paid_at = timezone('utc'::text, now()),
    mp_payment_type_id = COALESCE(nullif(trim(p_mp_payment_type_id), ''), mp_payment_type_id),
    mp_payment_method_id = COALESCE(nullif(trim(p_mp_payment_method_id), ''), mp_payment_method_id),
    mp_money_release_date = COALESCE(p_mp_money_release_date, mp_money_release_date),
    settlement_funding_type = v_funding,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_topup_order_id;

  v_lot_id := public.ensure_credit_wallet_funding_lot_from_topup(p_topup_order_id);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'ledger_id', v_ledger_id,
    'funding_lot_id', v_lot_id,
    'settlement_funding_type', v_funding,
    'balance', v_new_balance,
    'credit_granted', v_order.credit_granted_amount,
    'mp_fee_amount', v_mp_fee,
    'net_cash_received', v_net,
    'fee_validation_ok', v_fee_ok
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Rollback: devolve lotes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollback_credit_spend(
  p_spend_order_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.credit_spend_orders%ROWTYPE;
  v_account public.client_credit_accounts%ROWTYPE;
  v_new_balance NUMERIC(12, 2);
  v_analytics UUID[];
  v_meta JSONB;
BEGIN
  IF p_spend_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido inválido.';
  END IF;

  SELECT * INTO v_order
  FROM public.credit_spend_orders
  WHERE id = p_spend_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_order.status = 'reversed' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  SELECT metadata INTO v_meta
  FROM public.credit_ledger_entries
  WHERE reference_type = 'credit_spend_order'
    AND reference_id = p_spend_order_id
    AND entry_subtype = 'spend_debit'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_meta IS NOT NULL AND v_meta ? 'wristband_analytics_ids' THEN
    SELECT array_agg(value::uuid)
    INTO v_analytics
    FROM jsonb_array_elements_text(v_meta->'wristband_analytics_ids') AS value;
  END IF;

  IF v_analytics IS NOT NULL AND array_length(v_analytics, 1) > 0 THEN
    UPDATE public.wristband_analytics wa
    SET
      client_user_id = NULL,
      event_data = COALESCE(wa.event_data, '{}'::jsonb) - 'credit_spend_order_id' - 'payment_method'
    WHERE wa.id = ANY (v_analytics)
      AND wa.client_user_id = v_order.client_user_id;
  END IF;

  PERFORM public.ensure_client_credit_account(v_order.client_user_id);

  SELECT * INTO v_account
  FROM public.client_credit_accounts
  WHERE user_id = v_order.client_user_id
  FOR UPDATE;

  v_new_balance := round(v_account.balance_cached + v_order.gross_amount, 2);

  UPDATE public.client_credit_accounts
  SET
    balance_cached = v_new_balance,
    version = version + 1,
    updated_at = timezone('utc'::text, now())
  WHERE user_id = v_order.client_user_id;

  UPDATE public.platform_credit_liability
  SET
    outstanding_amount = outstanding_amount + v_order.gross_amount,
    updated_at = timezone('utc'::text, now())
  WHERE id = 1;

  UPDATE public.credit_spend_orders
  SET status = 'reversed'
  WHERE id = p_spend_order_id;

  UPDATE public.credit_mp_disbursements
  SET
    status = 'reversed',
    mp_error = left(COALESCE(p_reason, 'Estornado por falha no repasse.'), 2000),
    updated_at = timezone('utc'::text, now())
  WHERE spend_order_id = p_spend_order_id;

  UPDATE public.manager_credit_settlement_ledger m
  SET
    status = 'cancelled',
    clawback_reason = left(COALESCE(p_reason, 'Rollback spend.'), 500),
    updated_at = timezone('utc'::text, now())
  FROM public.credit_financial_splits s
  WHERE s.spend_order_id = p_spend_order_id
    AND m.split_id = s.id;

  PERFORM public.reverse_credit_spend_funding_allocations(p_spend_order_id);

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    correlation_id,
    receiver_company_id,
    reference_type,
    reference_id,
    public_description,
    internal_description
  ) VALUES (
    v_order.client_user_id,
    'adjustment',
    'spend_rollback',
    v_order.gross_amount,
    v_new_balance,
    'rollback:' || p_spend_order_id::text,
    v_order.correlation_id,
    v_order.receiver_company_id,
    'credit_spend_order',
    p_spend_order_id,
    format(
      E'**Estorno automático** — R$ %s devolvidos à sua carteira (falha no repasse ao parceiro).',
      to_char(v_order.gross_amount, 'FM999999990.00')
    ),
    left(COALESCE(p_reason, 'rollback'), 500)
  );

  RETURN jsonb_build_object('ok', true, 'balance', v_new_balance);
END;
$$;

-- RLS (somente leitura do próprio cliente / admin via funções)
ALTER TABLE public.credit_wallet_funding_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_spend_funding_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_wallet_funding_lots_select_own ON public.credit_wallet_funding_lots;
CREATE POLICY credit_wallet_funding_lots_select_own
  ON public.credit_wallet_funding_lots
  FOR SELECT TO authenticated
  USING (
    client_user_id = auth.uid()
    OR public.user_is_admin_master_for_rls()
  );

DROP POLICY IF EXISTS credit_spend_funding_allocations_select_scope ON public.credit_spend_funding_allocations;
CREATE POLICY credit_spend_funding_allocations_select_scope
  ON public.credit_spend_funding_allocations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.credit_spend_orders o
      WHERE o.id = spend_order_id
        AND (
          o.client_user_id = auth.uid()
          OR public.user_manages_credit_company(o.receiver_company_id)
          OR public.user_is_admin_master_for_rls()
        )
    )
  );

REVOKE ALL ON FUNCTION public.ensure_credit_wallet_funding_lot_from_topup(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_credit_spend_from_lots(UUID, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_credit_spend_funding_allocations(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_manager_credit_settlement_for_split(public.credit_financial_splits) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_credit_settlement_release_at(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_credit_wallet_funding_lot_from_topup(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_credit_spend_from_lots(UUID, UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_credit_spend_funding_allocations(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_credit_settlement_release_at(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- Evitar overload ambíguo no PostgREST (assinatura antiga 5 args)
DROP FUNCTION IF EXISTS public.credit_topup_settle(UUID, TEXT, NUMERIC, NUMERIC, TEXT);

-- Recriar trigger (função já substituída)
DROP TRIGGER IF EXISTS trg_credit_settlement_from_split ON public.credit_financial_splits;
CREATE TRIGGER trg_credit_settlement_from_split
  AFTER INSERT ON public.credit_financial_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_settlement_from_split();
