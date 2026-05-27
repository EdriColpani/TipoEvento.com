-- Permite upgrade de gestor para planos de consumo (híbrido e licença)

CREATE OR REPLACE FUNCTION public.billing_plan_selectable_by_gestor(p_plan public.billing_plan_type)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_plan IN (
    'listing_monthly'::public.billing_plan_type,
    'ticket_commission'::public.billing_plan_type,
    'ticket_plus_consumption'::public.billing_plan_type,
    'consumption_or_license'::public.billing_plan_type
  );
$$;

