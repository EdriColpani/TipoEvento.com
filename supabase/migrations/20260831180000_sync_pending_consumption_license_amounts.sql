-- Ao alterar taxa padrão / taxa da empresa, faturas pending devem acompanhar o valor vigente.
-- ensure passa a atualizar amount apenas em cobranças pending (não altera pagas).

CREATE OR REPLACE FUNCTION public.ensure_consumption_license_charge(
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

  IF v_company.billing_plan IS DISTINCT FROM 'consumption_or_license'::public.billing_plan_type THEN
    RAISE EXCEPTION 'Empresa não está no plano consumo/licença.';
  END IF;

  v_month := date_trunc('month', COALESCE(p_reference_month, CURRENT_DATE))::date;
  v_system_default := public.get_consumption_license_default_fee();
  v_amount := COALESCE(v_company.consumption_license_fee, v_system_default, 0);

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;

  INSERT INTO public.company_consumption_license_charges (
    company_id, reference_month, amount, status, created_by
  ) VALUES (
    p_company_id, v_month, v_amount, 'pending', auth.uid()
  )
  ON CONFLICT (company_id, reference_month)
  DO UPDATE SET
    amount = EXCLUDED.amount,
    updated_at = timezone('utc'::text, now())
  WHERE company_consumption_license_charges.status = 'pending'
  RETURNING * INTO v_charge;

  IF v_charge.id IS NULL THEN
    SELECT * INTO v_charge
    FROM public.company_consumption_license_charges
    WHERE company_id = p_company_id
      AND reference_month = v_month;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge.id,
    'reference_month', v_charge.reference_month,
    'amount', v_charge.amount,
    'status', v_charge.status,
    'already_paid', v_charge.status = 'paid',
    'requires_payment', v_charge.status <> 'paid'
  );
END;
$$;

-- Sincroniza faturas pending existentes com a taxa vigente (empresa ou padrão do sistema).
UPDATE public.company_consumption_license_charges ch
SET
  amount = COALESCE(c.consumption_license_fee, public.get_consumption_license_default_fee(), 0),
  updated_at = timezone('utc'::text, now())
FROM public.companies c
WHERE ch.company_id = c.id
  AND ch.status = 'pending'
  AND c.billing_plan = 'consumption_or_license'::public.billing_plan_type;
