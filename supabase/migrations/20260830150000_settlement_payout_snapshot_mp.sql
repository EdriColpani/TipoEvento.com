-- Snapshot de recebimento no relatório de repasse: inclui se o Mercado Pago está conectado.

CREATE OR REPLACE FUNCTION public.company_payout_bank_snapshot(p_company_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'payout_mode', p.payout_mode,
    'mp_configured', public.company_manager_has_mp_configured(p_company_id),
    'bank_code', p.bank_code,
    'bank_name', p.bank_name,
    'agency', p.agency,
    'account_number', p.account_number,
    'account_digit', p.account_digit,
    'account_type', p.account_type,
    'holder_name', p.holder_name,
    'holder_document', p.holder_document,
    'pix_key', p.pix_key,
    'pix_key_type', p.pix_key_type
  )
  FROM (SELECT p_company_id AS company_id) c
  LEFT JOIN public.company_payout_profiles p ON p.company_id = c.company_id;
$$;

GRANT EXECUTE ON FUNCTION public.company_payout_bank_snapshot(UUID) TO authenticated, service_role;
