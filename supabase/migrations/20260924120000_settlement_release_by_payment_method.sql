-- Fase 0+1: meio de pagamento MP + release_at do repasse de ingresso (D+1 / D+30).
-- Regra v0.2: cliente usa na hora; gestor PIX/débito D+1; cartão = money_release_date ou D+30.
-- Só novos lançamentos (sem backfill de fila antiga).

SELECT public.security_open_change_window('settlement release by payment method phase 0-1', 30);

-- ---------------------------------------------------------------------------
-- receivables (ingresso direto MP)
-- ---------------------------------------------------------------------------
ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS mp_payment_type_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_money_release_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_funding_type TEXT;

COMMENT ON COLUMN public.receivables.mp_payment_type_id IS
  'payment_type_id bruto do Mercado Pago (credit_card, debit_card, bank_transfer, …).';
COMMENT ON COLUMN public.receivables.mp_payment_method_id IS
  'payment_method_id bruto do Mercado Pago (visa, pix, master, …).';
COMMENT ON COLUMN public.receivables.mp_money_release_date IS
  'money_release_date do MP quando informado (liberação do valor na conta).';
COMMENT ON COLUMN public.receivables.settlement_funding_type IS
  'Normalizado: credit_card | debit_card | pix | other — define prazo de repasse D+1/D+30.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'receivables_settlement_funding_type_check'
  ) THEN
    ALTER TABLE public.receivables
      ADD CONSTRAINT receivables_settlement_funding_type_check
      CHECK (
        settlement_funding_type IS NULL
        OR settlement_funding_type IN ('credit_card', 'debit_card', 'pix', 'other')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receivables_settlement_funding_type
  ON public.receivables (settlement_funding_type)
  WHERE settlement_funding_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- credit_topup_orders (preparação Fase 2 — gravar meio já na Fase 0)
-- ---------------------------------------------------------------------------
ALTER TABLE public.credit_topup_orders
  ADD COLUMN IF NOT EXISTS mp_payment_type_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_money_release_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_funding_type TEXT;

COMMENT ON COLUMN public.credit_topup_orders.settlement_funding_type IS
  'Origem da recarga normalizada (credit_card|debit_card|pix|other) para lotes/FIFO.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_topup_orders_settlement_funding_type_check'
  ) THEN
    ALTER TABLE public.credit_topup_orders
      ADD CONSTRAINT credit_topup_orders_settlement_funding_type_check
      CHECK (
        settlement_funding_type IS NULL
        OR settlement_funding_type IN ('credit_card', 'debit_card', 'pix', 'other')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ledger ingresso: espelho do meio para filtros/relatórios
-- ---------------------------------------------------------------------------
ALTER TABLE public.manager_ticket_settlement_ledger
  ADD COLUMN IF NOT EXISTS settlement_funding_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_delay_days INTEGER;

COMMENT ON COLUMN public.manager_ticket_settlement_ledger.settlement_funding_type IS
  'Meio que definiu o release_at (credit_card → D+30/MP; pix/debit → D+1).';
COMMENT ON COLUMN public.manager_ticket_settlement_ledger.settlement_delay_days IS
  'Dias de retenção aplicados (1 ou 30); NULL se usou money_release_date do MP.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'manager_ticket_settlement_funding_type_check'
  ) THEN
    ALTER TABLE public.manager_ticket_settlement_ledger
      ADD CONSTRAINT manager_ticket_settlement_funding_type_check
      CHECK (
        settlement_funding_type IS NULL
        OR settlement_funding_type IN ('credit_card', 'debit_card', 'pix', 'other')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_mp_settlement_funding_type(
  p_payment_type_id TEXT,
  p_payment_method_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_type TEXT := lower(trim(COALESCE(p_payment_type_id, '')));
  v_method TEXT := lower(trim(COALESCE(p_payment_method_id, '')));
BEGIN
  IF v_method = 'pix' OR v_method LIKE '%pix%' THEN
    RETURN 'pix';
  END IF;
  IF v_type = 'credit_card' OR v_type = 'credit' THEN
    RETURN 'credit_card';
  END IF;
  IF v_type = 'debit_card' OR v_type = 'debit' THEN
    RETURN 'debit_card';
  END IF;
  IF v_type IN ('bank_transfer', 'account_money', 'digital_currency') THEN
    RETURN 'pix';
  END IF;
  IF v_type = '' AND v_method = '' THEN
    RETURN NULL;
  END IF;
  RETURN 'other';
END;
$$;

COMMENT ON FUNCTION public.normalize_mp_settlement_funding_type(TEXT, TEXT) IS
  'Normaliza payment_type/method do MP para credit_card|debit_card|pix|other.';

CREATE OR REPLACE FUNCTION public.compute_ticket_settlement_release_at(
  p_paid_at TIMESTAMPTZ,
  p_funding_type TEXT,
  p_money_release_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_base TIMESTAMPTZ := COALESCE(p_paid_at, timezone('utc'::text, now()));
  v_funding TEXT := COALESCE(nullif(trim(p_funding_type), ''), 'other');
BEGIN
  -- Cartão de crédito: data do MP se vier; senão D+30.
  IF v_funding = 'credit_card' THEN
    IF p_money_release_date IS NOT NULL THEN
      RETURN p_money_release_date;
    END IF;
    RETURN v_base + make_interval(days => 30);
  END IF;

  -- PIX / débito / other: D+1 (regra v0.2).
  RETURN v_base + make_interval(days => 1);
END;
$$;

COMMENT ON FUNCTION public.compute_ticket_settlement_release_at(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) IS
  'release_at do ledger de ingresso: credit_card = money_release_date ou D+30; demais = D+1.';

-- ---------------------------------------------------------------------------
-- create_ticket_settlement_from_receivable: usa meio + money_release_date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ticket_settlement_from_receivable(
  p_receivable_id UUID,
  p_company_id UUID,
  p_event_id UUID,
  p_gross_amount NUMERIC,
  p_platform_fee NUMERIC,
  p_mp_fee_amount NUMERIC,
  p_manager_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_manager NUMERIC(12, 2);
  v_base_at TIMESTAMPTZ;
  v_funding TEXT;
  v_money_release TIMESTAMPTZ;
  v_release_at TIMESTAMPTZ;
  v_delay_days INTEGER;
BEGIN
  IF p_receivable_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'Receivable/empresa inválidos.';
  END IF;

  v_manager := round(COALESCE(p_manager_amount, 0), 2);
  IF v_manager <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(r.paid_at, r.created_at, timezone('utc'::text, now())),
    COALESCE(
      nullif(trim(r.settlement_funding_type), ''),
      public.normalize_mp_settlement_funding_type(r.mp_payment_type_id, r.mp_payment_method_id),
      'other'
    ),
    r.mp_money_release_date
  INTO v_base_at, v_funding, v_money_release
  FROM public.receivables r
  WHERE r.id = p_receivable_id;

  v_base_at := COALESCE(v_base_at, timezone('utc'::text, now()));
  v_funding := COALESCE(v_funding, 'other');
  v_release_at := public.compute_ticket_settlement_release_at(v_base_at, v_funding, v_money_release);

  IF v_funding = 'credit_card' AND v_money_release IS NOT NULL THEN
    v_delay_days := NULL;
  ELSIF v_funding = 'credit_card' THEN
    v_delay_days := 30;
  ELSE
    v_delay_days := 1;
  END IF;

  INSERT INTO public.manager_ticket_settlement_ledger (
    company_id,
    event_id,
    receivable_id,
    gross_amount,
    platform_fee,
    mp_fee_amount,
    manager_amount,
    status,
    release_at,
    settlement_funding_type,
    settlement_delay_days
  ) VALUES (
    p_company_id,
    p_event_id,
    p_receivable_id,
    round(COALESCE(p_gross_amount, 0), 2),
    round(COALESCE(p_platform_fee, 0), 2),
    round(COALESCE(p_mp_fee_amount, 0), 2),
    v_manager,
    'pending',
    v_release_at,
    v_funding,
    v_delay_days
  )
  ON CONFLICT (receivable_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.manager_ticket_settlement_ledger
    WHERE receivable_id = p_receivable_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_ticket_settlement_from_receivable(UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC) IS
  'Cria ledger de ingresso (manual_d1) com release_at por meio: PIX/débito D+1; cartão money_release_date ou D+30.';

REVOKE ALL ON FUNCTION public.normalize_mp_settlement_funding_type(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_ticket_settlement_release_at(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_mp_settlement_funding_type(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_ticket_settlement_release_at(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
