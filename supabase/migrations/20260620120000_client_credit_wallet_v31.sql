-- Fase 1: Carteira EventFest (crédito universal) + recarga MP + ledger com extrato

-- ---------------------------------------------------------------------------
-- Bootstrap: system_billing_settings (quando migrations 20260520+ não rodaram)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_billing_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  listing_monthly_default_fee NUMERIC(10, 2) NOT NULL DEFAULT 199.90
    CHECK (listing_monthly_default_fee >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT system_billing_settings_singleton CHECK (id = 1)
);

INSERT INTO public.system_billing_settings (id, listing_monthly_default_fee)
VALUES (1, 199.90)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS consumption_module_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hybrid_consumption_module_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_consumption_commission_pct NUMERIC(5, 2) NOT NULL DEFAULT 8.00,
  ADD COLUMN IF NOT EXISTS credit_mp_fee_estimate_pct NUMERIC(7, 4) NOT NULL DEFAULT 0.0499;

-- CHECK constraints em colunas novas (ignora se já existirem)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_billing_settings_credit_commission_pct_check'
  ) THEN
    ALTER TABLE public.system_billing_settings
      ADD CONSTRAINT system_billing_settings_credit_commission_pct_check
      CHECK (credit_consumption_commission_pct >= 0 AND credit_consumption_commission_pct <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_billing_settings_credit_mp_fee_pct_check'
  ) THEN
    ALTER TABLE public.system_billing_settings
      ADD CONSTRAINT system_billing_settings_credit_mp_fee_pct_check
      CHECK (credit_mp_fee_estimate_pct >= 0 AND credit_mp_fee_estimate_pct <= 1);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.system_billing_settings.credit_consumption_commission_pct IS
  '% EventFest sobre cada uso de crédito; também teto para taxa MP na recarga.';
COMMENT ON COLUMN public.system_billing_settings.credit_mp_fee_estimate_pct IS
  'Estimativa da taxa MP na recarga (ex. 0.0499 = 4,99%) para validação antes do checkout.';

ALTER TABLE public.system_billing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_billing_settings_select" ON public.system_billing_settings;
CREATE POLICY "system_billing_settings_select"
  ON public.system_billing_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Admin RLS helper (se migrations 20260320+ não rodaram)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.user_is_admin_master_for_rls()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.tipo_usuario_id = 1
        );
      $body$;
    $fn$;
  ELSE
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.user_is_admin_master_for_rls()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT false;
      $body$;
    $fn$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Contas e passivo plataforma
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_credit_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cached NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (balance_cached >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'closed')),
  currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.platform_credit_liability (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  outstanding_amount NUMERIC(14, 2) NOT NULL DEFAULT 0
    CHECK (outstanding_amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT platform_credit_liability_singleton CHECK (id = 1)
);

INSERT INTO public.platform_credit_liability (id, outstanding_amount)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Pedidos de recarga
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_topup_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  origin_company_id UUID,
  origin_event_id UUID,
  gross_paid_amount NUMERIC(12, 2) NOT NULL CHECK (gross_paid_amount > 0),
  credit_granted_amount NUMERIC(12, 2) NOT NULL CHECK (credit_granted_amount > 0),
  mp_fee_amount NUMERIC(12, 2),
  net_cash_received NUMERIC(12, 2),
  mp_fee_pct_snapshot NUMERIC(7, 4),
  consumption_commission_pct_snapshot NUMERIC(5, 2),
  fee_validation_ok BOOLEAN,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  public_description TEXT,
  internal_description TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT credit_topup_orders_mp_payment_unique UNIQUE (mp_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_topup_orders_client
  ON public.credit_topup_orders(client_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_topup_orders_status
  ON public.credit_topup_orders(status);

-- ---------------------------------------------------------------------------
-- Ledger (extrato)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('topup', 'spend', 'refund', 'adjustment', 'hold', 'release')),
  entry_subtype TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  balance_after NUMERIC(12, 2) NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id UUID,
  origin_company_id UUID,
  origin_event_id UUID,
  receiver_company_id UUID,
  receiver_event_id UUID,
  receiver_establishment_id UUID,
  reference_type TEXT,
  reference_id UUID,
  public_description TEXT NOT NULL,
  internal_description TEXT,
  gross_paid_amount NUMERIC(12, 2),
  credit_granted_amount NUMERIC(12, 2),
  mp_fee_amount NUMERIC(12, 2),
  net_cash_received NUMERIC(12, 2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_account_created
  ON public.credit_ledger_entries(account_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Spend (estrutura Fase 3+; tabelas vazias na Fase 1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.credit_establishments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  event_id UUID,
  name TEXT NOT NULL,
  credit_acceptance_enabled BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.credit_spend_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_company_id UUID NOT NULL,
  receiver_event_id UUID,
  receiver_establishment_id UUID REFERENCES public.credit_establishments(id) ON DELETE SET NULL,
  gross_amount NUMERIC(12, 2) NOT NULL CHECK (gross_amount > 0),
  channel TEXT NOT NULL DEFAULT 'web'
    CHECK (channel IN ('web', 'app', 'pos')),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  public_description TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  idempotency_key TEXT UNIQUE,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.credit_spend_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spend_order_id UUID NOT NULL REFERENCES public.credit_spend_orders(id) ON DELETE CASCADE,
  product_id UUID,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'consumption'
    CHECK (item_type IN ('ticket', 'consumption'))
);

CREATE TABLE IF NOT EXISTS public.credit_financial_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spend_order_id UUID NOT NULL REFERENCES public.credit_spend_orders(id) ON DELETE CASCADE,
  receiver_company_id UUID NOT NULL,
  gross_amount NUMERIC(12, 2) NOT NULL,
  platform_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  manager_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  applied_percentage NUMERIC(5, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Coluna em events só se a tabela existir (schema pode estar incompleto no SQL Editor)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'events'
  ) THEN
    ALTER TABLE public.events
      ADD COLUMN IF NOT EXISTS credit_consumption_enabled BOOLEAN NOT NULL DEFAULT false;
    COMMENT ON COLUMN public.events.credit_consumption_enabled IS
      'Quando true, evento aceita pagamento com crédito EventFest (rede).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.credit_module_globally_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT s.consumption_module_enabled OR s.hybrid_consumption_module_enabled
      FROM public.system_billing_settings s
      WHERE s.id = 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.get_credit_consumption_commission_pct()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.credit_consumption_commission_pct FROM public.system_billing_settings s WHERE s.id = 1),
    8.00::NUMERIC
  );
$$;

CREATE OR REPLACE FUNCTION public.get_credit_mp_fee_estimate_pct()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.credit_mp_fee_estimate_pct FROM public.system_billing_settings s WHERE s.id = 1),
    0.0499::NUMERIC
  );
$$;

CREATE OR REPLACE FUNCTION public.format_credit_topup_public_description(
  p_amount NUMERIC,
  p_topup_id UUID,
  p_paid_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT format(
    'Recarga de crédito EventFest — R$ %s creditados na sua carteira. Pagamento via Mercado Pago em %s. Referência: #%s. O valor creditado corresponde ao valor pago. Taxas de processamento do Mercado Pago não reduzem seu saldo de crédito, conforme Termos de Uso.',
    trim(to_char(p_amount, 'FM999999990.00')),
    to_char(p_paid_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    left(replace(p_topup_id::text, '-', ''), 12)
  );
$$;

CREATE OR REPLACE FUNCTION public.validate_credit_topup_amount(p_gross_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gross NUMERIC(12, 2);
  v_commission_pct NUMERIC(5, 2);
  v_estimate_mp_pct NUMERIC(7, 4);
  v_max_mp_fee NUMERIC(12, 2);
  v_estimated_mp_fee NUMERIC(12, 2);
  v_ok BOOLEAN;
BEGIN
  v_gross := round(COALESCE(p_gross_amount, 0)::numeric, 2);
  IF v_gross < 10 OR v_gross > 10000 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Valor de recarga deve estar entre R$ 10,00 e R$ 10.000,00.'
    );
  END IF;

  IF NOT public.credit_module_globally_enabled() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Módulo de créditos EventFest ainda não está disponível.'
    );
  END IF;

  v_commission_pct := public.get_credit_consumption_commission_pct();
  v_estimate_mp_pct := public.get_credit_mp_fee_estimate_pct();
  v_estimated_mp_fee := round(v_gross * v_estimate_mp_pct, 2);
  v_max_mp_fee := round(v_gross * (v_commission_pct / 100.0), 2);
  v_ok := v_estimated_mp_fee <= v_max_mp_fee + 0.001;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'gross_amount', v_gross,
    'credit_granted_amount', v_gross,
    'consumption_commission_pct', v_commission_pct,
    'estimated_mp_fee_pct', v_estimate_mp_pct,
    'estimated_mp_fee_amount', v_estimated_mp_fee,
    'max_allowed_mp_fee_amount', v_max_mp_fee,
    'error', CASE WHEN v_ok THEN NULL ELSE
      'A taxa estimada do Mercado Pago excede a comissão EventFest permitida para este valor. Ajuste o pacote ou contate o suporte.'
    END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Conta e saldo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_client_credit_account(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.client_credit_accounts (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_credit_balance(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_row public.client_credit_accounts%ROWTYPE;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF v_uid IS DISTINCT FROM auth.uid()
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.ensure_client_credit_account(v_uid);

  SELECT * INTO v_row FROM public.client_credit_accounts WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'user_id', v_uid,
    'balance', COALESCE(v_row.balance_cached, 0),
    'currency', COALESCE(v_row.currency, 'BRL'),
    'status', COALESCE(v_row.status, 'active')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_credit_ledger(
  p_user_id UUID DEFAULT auth.uid(),
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF public.credit_ledger_entries
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF v_uid IS DISTINCT FROM auth.uid()
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  RETURN QUERY
  SELECT e.*
  FROM public.credit_ledger_entries e
  WHERE e.account_user_id = v_uid
  ORDER BY e.created_at DESC
  LIMIT greatest(1, least(COALESCE(p_limit, 50), 200))
  OFFSET greatest(0, COALESCE(p_offset, 0));
END;
$$;

-- ---------------------------------------------------------------------------
-- Recarga: criar pedido + anexar preferência MP
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_credit_topup_order(
  p_gross_amount NUMERIC,
  p_origin_company_id UUID DEFAULT NULL,
  p_origin_event_id UUID DEFAULT NULL,
  p_client_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_validation JSONB;
  v_order_id UUID;
  v_commission_pct NUMERIC(5, 2);
BEGIN
  v_uid := COALESCE(p_client_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF v_uid IS DISTINCT FROM auth.uid()
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  v_validation := public.validate_credit_topup_amount(p_gross_amount);
  IF NOT COALESCE((v_validation->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '%', COALESCE(v_validation->>'error', 'Valor de recarga inválido.');
  END IF;

  v_commission_pct := public.get_credit_consumption_commission_pct();

  INSERT INTO public.credit_topup_orders (
    client_user_id,
    origin_company_id,
    origin_event_id,
    gross_paid_amount,
    credit_granted_amount,
    consumption_commission_pct_snapshot,
    status
  ) VALUES (
    v_uid,
    p_origin_company_id,
    p_origin_event_id,
    (v_validation->>'gross_amount')::numeric,
    (v_validation->>'credit_granted_amount')::numeric,
    v_commission_pct,
    'pending'
  )
  RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'gross_paid_amount', (v_validation->>'gross_amount')::numeric,
    'credit_granted_amount', (v_validation->>'credit_granted_amount')::numeric,
    'consumption_commission_pct', v_commission_pct
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_credit_topup_mp_preference(
  p_order_id UUID,
  p_preference_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.credit_topup_orders
  SET
    mp_preference_id = p_preference_id,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id
    AND status = 'pending';
END;
$$;

-- ---------------------------------------------------------------------------
-- Liquidação webhook (idempotente)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.credit_topup_settle(
  p_topup_order_id UUID,
  p_mp_payment_id TEXT,
  p_mp_fee_amount NUMERIC DEFAULT NULL,
  p_net_cash_received NUMERIC DEFAULT NULL,
  p_payment_status TEXT DEFAULT 'approved'
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

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_paid', true,
      'order_id', v_order.id,
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
      'MP %s | taxa R$ %s | líquido caixa R$ %s | fee_validation=%s',
      p_mp_payment_id, v_mp_fee, v_net, v_fee_ok
    ),
    v_order.gross_paid_amount,
    v_order.credit_granted_amount,
    v_mp_fee,
    v_net,
    jsonb_build_object(
      'mp_payment_id', p_mp_payment_id,
      'fee_validation_ok', v_fee_ok,
      'consumption_commission_pct', v_commission_pct
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
    updated_at = timezone('utc'::text, now())
  WHERE id = p_topup_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'ledger_id', v_ledger_id,
    'balance', v_new_balance,
    'credit_granted', v_order.credit_granted_amount,
    'mp_fee_amount', v_mp_fee,
    'net_cash_received', v_net,
    'fee_validation_ok', v_fee_ok
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.client_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_credit_liability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_topup_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_spend_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_financial_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_establishments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_credit_accounts_select_own ON public.client_credit_accounts;
CREATE POLICY client_credit_accounts_select_own
  ON public.client_credit_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS credit_ledger_select_own ON public.credit_ledger_entries;
CREATE POLICY credit_ledger_select_own
  ON public.credit_ledger_entries FOR SELECT TO authenticated
  USING (account_user_id = auth.uid() OR public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS credit_topup_orders_select_own ON public.credit_topup_orders;
CREATE POLICY credit_topup_orders_select_own
  ON public.credit_topup_orders FOR SELECT TO authenticated
  USING (client_user_id = auth.uid() OR public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS platform_credit_liability_admin ON public.platform_credit_liability;
CREATE POLICY platform_credit_liability_admin
  ON public.platform_credit_liability FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS credit_spend_orders_select_scope ON public.credit_spend_orders;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_companies'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY credit_spend_orders_select_scope
        ON public.credit_spend_orders FOR SELECT TO authenticated
        USING (
          client_user_id = auth.uid()
          OR public.user_is_admin_master_for_rls()
          OR EXISTS (
            SELECT 1 FROM public.user_companies uc
            WHERE uc.company_id = credit_spend_orders.receiver_company_id
              AND uc.user_id = auth.uid()
          )
        )
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY credit_spend_orders_select_scope
        ON public.credit_spend_orders FOR SELECT TO authenticated
        USING (
          client_user_id = auth.uid()
          OR public.user_is_admin_master_for_rls()
        )
    $policy$;
  END IF;
END $$;

DROP POLICY IF EXISTS credit_financial_splits_select_scope ON public.credit_financial_splits;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_companies'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY credit_financial_splits_select_scope
        ON public.credit_financial_splits FOR SELECT TO authenticated
        USING (
          public.user_is_admin_master_for_rls()
          OR EXISTS (
            SELECT 1 FROM public.user_companies uc
            WHERE uc.company_id = credit_financial_splits.receiver_company_id
              AND uc.user_id = auth.uid()
          )
        )
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY credit_financial_splits_select_scope
        ON public.credit_financial_splits FOR SELECT TO authenticated
        USING (public.user_is_admin_master_for_rls())
    $policy$;
  END IF;
END $$;

DROP POLICY IF EXISTS credit_establishments_select_authenticated ON public.credit_establishments;
CREATE POLICY credit_establishments_select_authenticated
  ON public.credit_establishments FOR SELECT TO authenticated
  USING (active = true OR public.user_is_admin_master_for_rls());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.client_credit_accounts TO authenticated;
GRANT SELECT ON public.credit_ledger_entries TO authenticated;
GRANT SELECT ON public.credit_topup_orders TO authenticated;
GRANT SELECT ON public.credit_establishments TO authenticated;

GRANT EXECUTE ON FUNCTION public.validate_credit_topup_amount(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_credit_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_credit_ledger(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_credit_topup_order(NUMERIC, UUID, UUID, UUID) TO authenticated;
