-- Fase 5: listagem de aceites para o gestor + leitura de PDF via Storage (já com policies).

CREATE OR REPLACE FUNCTION public.list_manager_company_contract_acceptances(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa não informada.';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR public.user_can_manage_company_billing(p_company_id)
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para consultar aceites desta empresa.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.accepted_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ca.id,
      ca.contract_id,
      ca.contract_version,
      ca.contract_type,
      ca.accepted_at,
      ca.contract_title_snapshot,
      ca.content_hash,
      ca.document_hash,
      ca.acceptance_source,
      ca.verification_method,
      ca.verification_channel,
      ca.verified_at,
      ca.pdf_storage_path,
      ca.pdf_generated_at,
      ca.commercial_terms_snapshot,
      ca.party_snapshot,
      ca.scrolled_to_end,
      ec.version AS current_contract_version,
      ec.is_active AS current_contract_is_active
    FROM public.contract_acceptances ca
    LEFT JOIN public.event_contracts ec ON ec.id = ca.contract_id
    WHERE ca.company_id = p_company_id
    ORDER BY ca.accepted_at DESC
    LIMIT 200
  ) t;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE(jsonb_array_length(v_items), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_manager_company_contract_acceptances(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_manager_company_contract_acceptances(UUID) TO authenticated;
