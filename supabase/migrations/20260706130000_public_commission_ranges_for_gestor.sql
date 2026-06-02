-- Gestor precisa ver faixas de comissão na escolha de plano (RLS de commission_ranges é só Admin Master).
CREATE OR REPLACE FUNCTION public.get_public_commission_ranges()
RETURNS TABLE (
  min_tickets integer,
  max_tickets integer,
  percentage numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cr.min_tickets, cr.max_tickets, cr.percentage
  FROM public.commission_ranges cr
  WHERE cr.active = true
  ORDER BY cr.min_tickets ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_commission_ranges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_commission_ranges() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_commission_ranges() TO anon;
