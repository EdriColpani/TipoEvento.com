-- register_contract_acceptance: ao aceitar contrato billing via OTP, sincroniza reaceite do plano.

CREATE OR REPLACE FUNCTION public.register_contract_acceptance(
  p_contract_id UUID,
  p_contract_type TEXT,
  p_company_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_acceptance_source TEXT DEFAULT 'web',
  p_user_agent TEXT DEFAULT NULL,
  p_accepted_ip TEXT DEFAULT NULL,
  p_scrolled_to_end BOOLEAN DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_party_snapshot JSONB DEFAULT '{}'::jsonb,
  p_commercial_terms_snapshot JSONB DEFAULT '{}'::jsonb,
  p_presented_document_text TEXT DEFAULT NULL,
  p_document_hash TEXT DEFAULT NULL,
  p_verification_method TEXT DEFAULT NULL,
  p_verification_channel TEXT DEFAULT NULL,
  p_verified_at TIMESTAMPTZ DEFAULT NULL,
  p_pdf_storage_path TEXT DEFAULT NULL,
  p_pdf_generated_at TIMESTAMPTZ DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_otp_challenge_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_contract public.event_contracts%ROWTYPE;
  v_target_user UUID;
  v_hash TEXT;
  v_doc_hash TEXT;
  v_acceptance_id UUID;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_presented TEXT;
  v_existing public.contract_acceptances%ROWTYPE;
  v_is_service BOOLEAN := (auth.role() = 'service_role');
  v_source TEXT := NULLIF(trim(COALESCE(p_acceptance_source, '')), '');
BEGIN
  v_actor := COALESCE(p_user_id, auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_contract_id IS NULL OR p_contract_type IS NULL OR trim(p_contract_type) = '' THEN
    RAISE EXCEPTION 'Contrato inválido para aceite.';
  END IF;

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing
    FROM public.contract_acceptances
    WHERE idempotency_key = trim(p_idempotency_key);

    IF v_existing.id IS NOT NULL THEN
      IF p_company_id IS NOT NULL AND v_source IN ('billing', 'billing_upgrade') THEN
        PERFORM public.sync_company_billing_after_secure_acceptance(
          p_company_id,
          v_existing.contract_id,
          v_existing.contract_type,
          v_actor,
          v_existing.accepted_at
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'acceptance_id', v_existing.id,
        'contract_id', v_existing.contract_id,
        'contract_version', v_existing.contract_version,
        'content_hash', v_existing.content_hash,
        'document_hash', v_existing.document_hash,
        'accepted_at', v_existing.accepted_at,
        'pdf_storage_path', v_existing.pdf_storage_path
      );
    END IF;
  END IF;

  IF NOT v_is_service THEN
    IF p_company_id IS NOT NULL THEN
      IF NOT (
        public.user_is_admin_master_for_rls()
        OR public.user_can_manage_company_billing(p_company_id)
        OR EXISTS (
          SELECT 1 FROM public.user_companies uc
          WHERE uc.company_id = p_company_id AND uc.user_id = v_actor
        )
      ) THEN
        RAISE EXCEPTION 'Sem permissão para registrar aceite desta empresa.';
      END IF;
    ELSIF v_actor IS DISTINCT FROM auth.uid() AND NOT public.user_is_admin_master_for_rls() THEN
      RAISE EXCEPTION 'Sem permissão para registrar aceite de outro usuário.';
    END IF;
  ELSIF p_user_id IS NULL THEN
    RAISE EXCEPTION 'service_role exige p_user_id para registrar aceite.';
  END IF;

  SELECT * INTO v_contract
  FROM public.event_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  IF v_contract.contract_type IS DISTINCT FROM trim(p_contract_type) THEN
    RAISE EXCEPTION 'Tipo de contrato não corresponde ao contrato informado.';
  END IF;

  v_presented := COALESCE(NULLIF(p_presented_document_text, ''), v_contract.content);
  v_hash := public.compute_contract_content_hash(v_contract.content);
  v_doc_hash := COALESCE(
    NULLIF(trim(COALESCE(p_document_hash, '')), ''),
    public.compute_contract_content_hash(v_presented)
  );
  v_target_user := v_actor;

  INSERT INTO public.contract_acceptances (
    user_id, company_id, contract_id, contract_version, contract_type, accepted_at,
    contract_title_snapshot, content_snapshot, content_hash, acceptance_source,
    accepted_ip, user_agent, scrolled_to_end, metadata,
    party_snapshot, commercial_terms_snapshot, presented_document_text, document_hash,
    verification_method, verification_channel, verified_at, pdf_storage_path,
    pdf_generated_at, idempotency_key, otp_challenge_id
  ) VALUES (
    v_target_user, p_company_id, v_contract.id, v_contract.version, v_contract.contract_type, v_now,
    v_contract.title, v_contract.content, v_hash, v_source,
    NULLIF(trim(p_accepted_ip), ''), NULLIF(left(trim(COALESCE(p_user_agent, '')), 2000), ''),
    p_scrolled_to_end, COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_party_snapshot, '{}'::jsonb), COALESCE(p_commercial_terms_snapshot, '{}'::jsonb),
    v_presented, v_doc_hash,
    NULLIF(trim(COALESCE(p_verification_method, '')), ''),
    NULLIF(trim(COALESCE(p_verification_channel, '')), ''),
    p_verified_at, NULLIF(trim(COALESCE(p_pdf_storage_path, '')), ''),
    p_pdf_generated_at, NULLIF(trim(COALESCE(p_idempotency_key, '')), ''), p_otp_challenge_id
  )
  RETURNING id INTO v_acceptance_id;

  IF trim(p_contract_type) = 'client_terms' THEN
    UPDATE public.profiles
    SET contract_version_accepted_id = v_contract.id
    WHERE id = v_target_user;
  END IF;

  IF p_company_id IS NOT NULL THEN
    UPDATE public.companies
    SET contract_version_accepted_id = v_contract.id
    WHERE id = p_company_id;

    IF v_source IN ('billing', 'billing_upgrade') THEN
      PERFORM public.sync_company_billing_after_secure_acceptance(
        p_company_id,
        v_contract.id,
        v_contract.contract_type,
        v_actor,
        v_now
      );
    END IF;
  END IF;

  PERFORM public.log_contract_acceptance_audit_event(
    'acceptance_created',
    v_target_user,
    v_acceptance_id,
    p_otp_challenge_id,
    p_company_id,
    v_contract.id,
    jsonb_build_object(
      'acceptance_source', v_source,
      'verification_method', NULLIF(trim(COALESCE(p_verification_method, '')), ''),
      'document_hash', v_doc_hash,
      'via_service_role', v_is_service
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'acceptance_id', v_acceptance_id,
    'contract_id', v_contract.id,
    'contract_version', v_contract.version,
    'content_hash', v_hash,
    'document_hash', v_doc_hash,
    'accepted_at', v_now,
    'pdf_storage_path', NULLIF(trim(COALESCE(p_pdf_storage_path, '')), '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_contract_acceptance(
  UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB,
  JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT, UUID
) TO authenticated, service_role;
