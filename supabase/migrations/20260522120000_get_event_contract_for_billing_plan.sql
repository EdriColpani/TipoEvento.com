-- Gestor lê contrato do plano via RPC (evita bloqueio por RLS em event_contracts)

CREATE OR REPLACE FUNCTION public.get_event_contract_for_billing_plan(p_plan public.billing_plan_type)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_contracts%ROWTYPE;
  v_types TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_types := ARRAY[p_plan::TEXT];
  IF p_plan = 'ticket_commission'::public.billing_plan_type THEN
    v_types := v_types || ARRAY['event_terms'];
  ELSIF p_plan = 'listing_monthly'::public.billing_plan_type THEN
    v_types := v_types || ARRAY['company_membership'];
  END IF;

  SELECT *
  INTO v_row
  FROM public.event_contracts ec
  WHERE ec.contract_type = ANY (v_types)
  ORDER BY ec.is_active DESC NULLS LAST, ec.updated_at DESC NULLS LAST, ec.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_contract_for_billing_plan(public.billing_plan_type) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_contract_for_billing_plan(public.billing_plan_type) TO authenticated;
