-- Métrica de passivo de ingresso D+1 (bank_transfer) para posição financeira Admin.

CREATE OR REPLACE FUNCTION public.get_ticket_manual_settlement_totals()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending_retention', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'awaiting_payment', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0),
    'paid', COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN status = 'clawback' THEN manager_amount ELSE 0 END), 0)
  )
  FROM public.manager_ticket_settlement_ledger;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_manual_settlement_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ticket_manual_settlement_totals() TO authenticated, service_role;
