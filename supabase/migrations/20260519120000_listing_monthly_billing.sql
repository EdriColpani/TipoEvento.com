-- Fase 4: plano mensalidade (vitrine) + cobranças mensais + bloqueio de venda de ingressos

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS listing_monthly_fee NUMERIC(10, 2);

COMMENT ON COLUMN public.companies.listing_monthly_fee IS 'Valor mensal de divulgação (plano listing_monthly). NULL = usar padrão do sistema.';

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS listing_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.listing_only IS 'true = evento vitrine (sem venda de ingressos pela plataforma).';

-- Eventos de empresas já em listing_monthly
UPDATE public.events e
SET listing_only = true,
    is_paid = false
FROM public.companies c
WHERE e.company_id = c.id
  AND c.billing_plan = 'listing_monthly'::public.billing_plan_type;

CREATE TABLE IF NOT EXISTS public.company_listing_monthly_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  notes TEXT,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (company_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_listing_charges_company_month
  ON public.company_listing_monthly_charges(company_id, reference_month DESC);

CREATE INDEX IF NOT EXISTS idx_listing_charges_status
  ON public.company_listing_monthly_charges(status);

ALTER TABLE public.company_listing_monthly_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_charges_select" ON public.company_listing_monthly_charges;
CREATE POLICY "listing_charges_select"
  ON public.company_listing_monthly_charges
  FOR SELECT
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_listing_monthly_charges.company_id
        AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "listing_charges_admin_all" ON public.company_listing_monthly_charges;
CREATE POLICY "listing_charges_admin_all"
  ON public.company_listing_monthly_charges
  FOR ALL
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

-- Gestor pode marcar como pago apenas cobrança da própria empresa (opcional: só admin marca pago — v1 só admin escreve)
-- Política acima: admin ALL; gestor só SELECT

CREATE OR REPLACE FUNCTION public.company_allows_ticket_sales(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT c.billing_plan IS DISTINCT FROM 'listing_monthly'::public.billing_plan_type
      FROM public.companies c
      WHERE c.id = p_company_id
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.event_allows_ticket_sales(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        NOT COALESCE(e.listing_only, false)
        AND public.company_allows_ticket_sales(e.company_id)
      FROM public.events e
      WHERE e.id = p_event_id
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.company_allows_ticket_sales(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_allows_ticket_sales(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_allows_ticket_sales(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_allows_ticket_sales(UUID) TO authenticated;

-- Gera cobrança do mês para uma empresa em plano listing_monthly
CREATE OR REPLACE FUNCTION public.admin_create_listing_monthly_charge(
  p_company_id UUID,
  p_reference_month DATE,
  p_amount NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_amount NUMERIC(10, 2);
  v_month DATE;
  v_charge_id UUID;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode gerar cobranças.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF v_company.billing_plan IS DISTINCT FROM 'listing_monthly'::public.billing_plan_type THEN
    RAISE EXCEPTION 'Empresa não está no plano de mensalidade (vitrine).';
  END IF;

  v_month := date_trunc('month', COALESCE(p_reference_month, CURRENT_DATE))::date;
  v_amount := COALESCE(p_amount, v_company.listing_monthly_fee, 0);

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;

  INSERT INTO public.company_listing_monthly_charges (
    company_id, reference_month, amount, status, notes, created_by
  ) VALUES (
    p_company_id, v_month, v_amount, 'pending', p_notes, auth.uid()
  )
  ON CONFLICT (company_id, reference_month)
  DO UPDATE SET
    amount = EXCLUDED.amount,
    notes = COALESCE(EXCLUDED.notes, company_listing_monthly_charges.notes),
    updated_at = timezone('utc'::text, now())
  RETURNING id INTO v_charge_id;

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge_id,
    'reference_month', v_month,
    'amount', v_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_listing_charge_status(
  p_charge_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  IF p_status NOT IN ('pending', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  UPDATE public.company_listing_monthly_charges
  SET
    status = p_status,
    notes = COALESCE(p_notes, notes),
    paid_at = CASE WHEN p_status = 'paid' THEN timezone('utc'::text, now()) ELSE NULL END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada.';
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_listing_monthly_charge(UUID, DATE, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_listing_charge_status(UUID, TEXT, TEXT) TO authenticated;
