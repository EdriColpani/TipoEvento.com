-- Fase 4c: checkout Mercado Pago para mensalidade vitrine (gestor)

ALTER TABLE public.company_listing_monthly_charges
  ADD COLUMN IF NOT EXISTS mp_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS checkout_initiated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.company_listing_monthly_charges.mp_preference_id IS 'ID da preferência Mercado Pago.';
COMMENT ON COLUMN public.company_listing_monthly_charges.mp_payment_id IS 'ID do pagamento Mercado Pago quando confirmado.';

-- Garante cobrança do mês corrente (gestor ou admin)
CREATE OR REPLACE FUNCTION public.ensure_listing_monthly_charge(
  p_company_id UUID,
  p_reference_month DATE DEFAULT NULL
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
  v_charge RECORD;
  v_system_default NUMERIC(10, 2);
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.user_can_manage_company_billing(p_company_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão para esta empresa.';
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
  v_amount := COALESCE(v_company.listing_monthly_fee, v_system_default, 0);

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;

  INSERT INTO public.company_listing_monthly_charges (
    company_id, reference_month, amount, status, created_by
  ) VALUES (
    p_company_id, v_month, v_amount, 'pending', auth.uid()
  )
  ON CONFLICT (company_id, reference_month)
  DO UPDATE SET
    amount = EXCLUDED.amount,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_charge;

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge.id,
    'reference_month', v_charge.reference_month,
    'amount', v_charge.amount,
    'status', v_charge.status,
    'already_paid', v_charge.status = 'paid'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_listing_charge_mp_preference(
  p_charge_id UUID,
  p_preference_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_listing_monthly_charges
  SET
    mp_preference_id = p_preference_id,
    checkout_initiated_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
    AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_listing_monthly_charge_payment(
  p_charge_id UUID,
  p_mp_payment_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge RECORD;
BEGIN
  UPDATE public.company_listing_monthly_charges
  SET
    status = 'paid',
    paid_at = timezone('utc'::text, now()),
    mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
    AND status = 'pending'
  RETURNING * INTO v_charge;

  IF v_charge.id IS NULL THEN
    SELECT * INTO v_charge
    FROM public.company_listing_monthly_charges
    WHERE id = p_charge_id;

    IF v_charge.id IS NULL THEN
      RAISE EXCEPTION 'Cobrança não encontrada.';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', v_charge.status, 'idempotent', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'paid', 'charge_id', v_charge.id);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_listing_monthly_charge(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_listing_charge_mp_preference(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_listing_monthly_charge_payment(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_listing_monthly_charge(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_listing_charge_mp_preference(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_listing_monthly_charge_payment(UUID, TEXT) TO service_role;
