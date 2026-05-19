-- Parâmetros globais de cobrança (mensalidade padrão vitrine, etc.)

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

ALTER TABLE public.system_billing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_billing_settings_select" ON public.system_billing_settings;
CREATE POLICY "system_billing_settings_select"
  ON public.system_billing_settings
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "system_billing_settings_admin_write" ON public.system_billing_settings;
CREATE POLICY "system_billing_settings_admin_write"
  ON public.system_billing_settings
  FOR ALL
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

CREATE OR REPLACE FUNCTION public.get_listing_monthly_default_fee()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.listing_monthly_default_fee FROM public.system_billing_settings s WHERE s.id = 1),
    199.90::NUMERIC
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_listing_monthly_default_fee() TO authenticated;

-- Usa mensalidade da empresa, depois padrão do sistema
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
  v_system_default NUMERIC(10, 2);
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
  v_system_default := public.get_listing_monthly_default_fee();
  v_amount := COALESCE(p_amount, v_company.listing_monthly_fee, v_system_default, 0);

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
