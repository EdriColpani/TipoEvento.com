-- Cartão: money_release_date do MP só vale se for prazo real (>= D+2).
-- Sandbox/testes frequentemente devolvem money_release_date ≈ agora; isso liberava
-- o repasse no mesmo dia e invertia o status vs a fila D+30.

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
  -- Cartão de crédito: data do MP só se for liberação futura real; senão D+30.
  IF v_funding = 'credit_card' THEN
    IF p_money_release_date IS NOT NULL
       AND p_money_release_date > (v_base + interval '2 days') THEN
      RETURN p_money_release_date;
    END IF;
    RETURN v_base + make_interval(days => 30);
  END IF;

  -- PIX / débito / other: D+1 (regra v0.2).
  RETURN v_base + make_interval(days => 1);
END;
$$;

COMMENT ON FUNCTION public.compute_ticket_settlement_release_at(TIMESTAMPTZ, TEXT, TIMESTAMPTZ) IS
  'release_at ingresso: credit_card = money_release_date (se >= D+2) ou D+30; demais = D+1.';

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

  IF v_funding = 'credit_card' THEN
    -- delay null = usou data MP confiável; 30 = fallback comercial
    IF v_money_release IS NOT NULL AND v_release_at = v_money_release THEN
      v_delay_days := NULL;
    ELSE
      v_delay_days := 30;
    END IF;
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

-- Repara lançamentos de cartão liberados cedo demais (money_release prematuro / sandbox).
WITH ticket_fix AS (
  UPDATE public.manager_ticket_settlement_ledger l
  SET
    release_at = public.compute_ticket_settlement_release_at(
      COALESCE(r.paid_at, r.created_at, l.created_at),
      'credit_card',
      r.mp_money_release_date
    ),
    settlement_delay_days = 30,
    status = CASE
      WHEN l.status IN ('pending', 'released') THEN 'pending'
      ELSE l.status
    END,
    released_at = CASE
      WHEN l.status IN ('pending', 'released') THEN NULL
      ELSE l.released_at
    END,
    updated_at = timezone('utc'::text, now())
  FROM public.receivables r
  WHERE r.id = l.receivable_id
    AND l.settlement_funding_type = 'credit_card'
    AND l.status IN ('pending', 'released')
    AND l.paid_at IS NULL
    AND l.release_at <= COALESCE(r.paid_at, r.created_at, l.created_at) + interval '2 days'
  RETURNING l.id
)
SELECT count(*) AS ticket_ledgers_fixed FROM ticket_fix;

WITH credit_fix AS (
  UPDATE public.manager_credit_settlement_ledger l
  SET
    release_at = public.compute_ticket_settlement_release_at(
      l.created_at,
      'credit_card',
      NULL
    ),
    settlement_delay_days = 30,
    status = CASE
      WHEN l.status IN ('pending', 'released') THEN 'pending'
      ELSE l.status
    END,
    released_at = CASE
      WHEN l.status IN ('pending', 'released') THEN NULL
      ELSE l.released_at
    END,
    updated_at = timezone('utc'::text, now())
  WHERE l.settlement_funding_type = 'credit_card'
    AND l.status IN ('pending', 'released')
    AND l.paid_at IS NULL
    AND l.release_at <= l.created_at + interval '2 days'
  RETURNING l.id
)
SELECT count(*) AS credit_ledgers_fixed FROM credit_fix;
