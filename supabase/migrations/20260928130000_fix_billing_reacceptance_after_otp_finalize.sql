-- Reaceite de plano: após OTP+assinatura (register_contract_acceptance billing),
-- limpa requires_billing_reacceptance sem depender do 2º passo no frontend.
-- Repara empresas que assinaram a nova versão mas ficaram presas na tela.

CREATE OR REPLACE FUNCTION public.sync_company_billing_after_secure_acceptance(
  p_company_id UUID,
  p_contract_id UUID,
  p_contract_type TEXT,
  p_actor_user_id UUID,
  p_accepted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_accepted_at TIMESTAMPTZ := COALESCE(p_accepted_at, timezone('utc'::text, now()));
BEGIN
  IF p_company_id IS NULL OR p_contract_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_company
  FROM public.companies
  WHERE id = p_company_id
  FOR UPDATE;

  IF v_company.id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT COALESCE(v_company.requires_billing_reacceptance, false) THEN
    RETURN false;
  END IF;

  IF v_company.billing_plan IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.contract_type_matches_billing_plan(v_company.billing_plan, trim(p_contract_type)) THEN
    RETURN false;
  END IF;

  UPDATE public.companies
  SET
    billing_contract_id = p_contract_id,
    billing_plan_accepted_at = v_accepted_at,
    requires_billing_reacceptance = false,
    contract_version_accepted_id = p_contract_id
  WHERE id = p_company_id;

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    v_company.billing_plan,
    p_actor_user_id,
    'reacceptance'
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_company_billing_after_secure_acceptance(UUID, UUID, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_company_billing_after_secure_acceptance(UUID, UUID, TEXT, UUID, TIMESTAMPTZ) TO service_role;

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

-- Repara empresas presas: aceite billing da versão ativa já existe, mas flag ainda true.
DO $repair$
DECLARE
  v_fixed INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.id AS company_id,
      ca.contract_id,
      ca.contract_type,
      ca.accepted_at,
      ca.user_id
    FROM public.companies c
    JOIN LATERAL (
      SELECT ca2.contract_id, ca2.contract_type, ca2.accepted_at, ca2.user_id, ca2.contract_version
      FROM public.contract_acceptances ca2
      WHERE ca2.company_id = c.id
        AND ca2.acceptance_source IN ('billing', 'billing_upgrade')
      ORDER BY ca2.accepted_at DESC
      LIMIT 1
    ) ca ON true
    JOIN public.event_contracts ec ON ec.id = ca.contract_id AND ec.is_active = true
    WHERE c.requires_billing_reacceptance = true
      AND c.billing_plan IS NOT NULL
      AND public.contract_type_matches_billing_plan(c.billing_plan, ca.contract_type)
      AND ca.contract_version = ec.version
  LOOP
    IF public.sync_company_billing_after_secure_acceptance(
      r.company_id,
      r.contract_id,
      r.contract_type,
      r.user_id,
      r.accepted_at
    ) THEN
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'billing_reacceptance_repair: companies_fixed=%', v_fixed;
END
$repair$;

-- Trigger de cadastro bloqueava reaceite (atualizar billing_plan_accepted_at) em empresas legadas.
CREATE OR REPLACE FUNCTION public.enforce_registration_before_billing_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.billing_plan IS NULL OR NEW.billing_plan_accepted_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.billing_plan IS NOT DISTINCT FROM NEW.billing_plan
     AND COALESCE(OLD.requires_billing_reacceptance, false) = true
     AND COALESCE(NEW.requires_billing_reacceptance, false) = false
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.billing_plan IS NOT DISTINCT FROM NEW.billing_plan
     AND OLD.billing_plan_accepted_at IS NOT DISTINCT FROM NEW.billing_plan_accepted_at
     AND OLD.billing_contract_id IS NOT DISTINCT FROM NEW.billing_contract_id
  THEN
    RETURN NEW;
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF NOT public.company_registration_gate_satisfied(NEW.id) THEN
    RAISE EXCEPTION
      'Assine o contrato de cadastro da empresa antes de confirmar o plano comercial.';
  END IF;

  RETURN NEW;
END;
$$;
