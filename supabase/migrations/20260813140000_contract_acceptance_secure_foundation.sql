-- Fase 1: aceite eletrônico seguro (fundação)
-- Objetivo: histórico append-only, snapshots, OTP por e-mail (challenge),
-- auditoria leve e bucket de PDF. Sem SMS. Sem alterar signup/auth e-mail.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) contract_acceptances: fim do "1 aceite por tipo" + colunas de evidência
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_contract_acceptances_user_contract_type;
DROP INDEX IF EXISTS public.idx_contract_acceptances_company_contract_type;

ALTER TABLE public.contract_acceptances
  ADD COLUMN IF NOT EXISTS party_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS commercial_terms_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presented_document_text TEXT,
  ADD COLUMN IF NOT EXISTS document_hash TEXT,
  ADD COLUMN IF NOT EXISTS verification_method TEXT,
  ADD COLUMN IF NOT EXISTS verification_channel TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS otp_challenge_id UUID;

COMMENT ON COLUMN public.contract_acceptances.party_snapshot IS
  'Snapshot do contratante no aceite (nome, CPF, CNPJ, e-mail, telefone, ids).';
COMMENT ON COLUMN public.contract_acceptances.commercial_terms_snapshot IS
  'Condições comerciais vigentes no momento do aceite (plano, taxas, etc.).';
COMMENT ON COLUMN public.contract_acceptances.presented_document_text IS
  'Texto canônico completo apresentado/assinado (base do hash e do PDF).';
COMMENT ON COLUMN public.contract_acceptances.document_hash IS
  'SHA-256 hex do presented_document_text (ou content_snapshot legado).';
COMMENT ON COLUMN public.contract_acceptances.verification_method IS
  'ex.: email_otp';
COMMENT ON COLUMN public.contract_acceptances.verification_channel IS
  'Destino mascarado usado na confirmação (ex.: ed***@gmail.com).';
COMMENT ON COLUMN public.contract_acceptances.pdf_storage_path IS
  'Path no bucket contract-acceptance-pdfs.';
COMMENT ON COLUMN public.contract_acceptances.idempotency_key IS
  'Chave única para evitar duplo aceite por clique/refresh.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_acceptances_idempotency_key
  ON public.contract_acceptances (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_user_type_accepted
  ON public.contract_acceptances (user_id, contract_type, accepted_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_company_type_accepted
  ON public.contract_acceptances (company_id, contract_type, accepted_at DESC)
  WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Challenges OTP (auxiliar — não é registro de aceite)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_acceptance_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contract_id UUID NOT NULL REFERENCES public.event_contracts(id) ON DELETE CASCADE,
  contract_type TEXT NOT NULL,
  acceptance_source TEXT NOT NULL DEFAULT 'web',
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  destination_email TEXT NOT NULL,
  destination_masked TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  accepted_ip TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.contract_acceptance_otp_challenges IS
  'Desafios OTP por e-mail para aceite de contrato. Código nunca em texto puro.';

CREATE INDEX IF NOT EXISTS idx_contract_otp_challenges_user_open
  ON public.contract_acceptance_otp_challenges (user_id, contract_id, created_at DESC)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_otp_challenges_expires
  ON public.contract_acceptance_otp_challenges (expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

ALTER TABLE public.contract_acceptances
  DROP CONSTRAINT IF EXISTS contract_acceptances_otp_challenge_id_fkey;

ALTER TABLE public.contract_acceptances
  ADD CONSTRAINT contract_acceptances_otp_challenge_id_fkey
  FOREIGN KEY (otp_challenge_id)
  REFERENCES public.contract_acceptance_otp_challenges(id)
  ON DELETE SET NULL;

ALTER TABLE public.contract_acceptance_otp_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_otp_challenges_select_self_or_admin
  ON public.contract_acceptance_otp_challenges;
CREATE POLICY contract_otp_challenges_select_self_or_admin
ON public.contract_acceptance_otp_challenges
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.user_is_admin_master_for_rls()
);

DROP POLICY IF EXISTS contract_otp_challenges_no_direct_write
  ON public.contract_acceptance_otp_challenges;
DROP POLICY IF EXISTS contract_otp_challenges_no_direct_insert
  ON public.contract_acceptance_otp_challenges;
CREATE POLICY contract_otp_challenges_no_direct_insert
ON public.contract_acceptance_otp_challenges
FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS contract_otp_challenges_no_direct_update
  ON public.contract_acceptance_otp_challenges;
CREATE POLICY contract_otp_challenges_no_direct_update
ON public.contract_acceptance_otp_challenges
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS contract_otp_challenges_no_direct_delete
  ON public.contract_acceptance_otp_challenges;
CREATE POLICY contract_otp_challenges_no_direct_delete
ON public.contract_acceptance_otp_challenges
FOR DELETE TO authenticated USING (false);

-- ---------------------------------------------------------------------------
-- 3) Auditoria de eventos (sem OTP em claro)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_acceptance_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acceptance_id UUID REFERENCES public.contract_acceptances(id) ON DELETE SET NULL,
  challenge_id UUID REFERENCES public.contract_acceptance_otp_challenges(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contract_id UUID REFERENCES public.event_contracts(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.contract_acceptance_audit_events IS
  'Trilha de eventos do fluxo de aceite (otp_sent, otp_verified, acceptance_created, pdf_stored, ...).';

CREATE INDEX IF NOT EXISTS idx_contract_audit_events_acceptance
  ON public.contract_acceptance_audit_events (acceptance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_audit_events_challenge
  ON public.contract_acceptance_audit_events (challenge_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_audit_events_company
  ON public.contract_acceptance_audit_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_audit_events_type
  ON public.contract_acceptance_audit_events (event_type, created_at DESC);

ALTER TABLE public.contract_acceptance_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_audit_events_select_self_or_admin
  ON public.contract_acceptance_audit_events;
CREATE POLICY contract_audit_events_select_self_or_admin
ON public.contract_acceptance_audit_events
FOR SELECT
TO authenticated
USING (
  actor_user_id = auth.uid()
  OR public.user_is_admin_master_for_rls()
  OR (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = contract_acceptance_audit_events.company_id
        AND uc.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS contract_audit_events_no_direct_write
  ON public.contract_acceptance_audit_events;
DROP POLICY IF EXISTS contract_audit_events_no_direct_insert
  ON public.contract_acceptance_audit_events;
CREATE POLICY contract_audit_events_no_direct_insert
ON public.contract_acceptance_audit_events
FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS contract_audit_events_no_direct_update
  ON public.contract_acceptance_audit_events;
CREATE POLICY contract_audit_events_no_direct_update
ON public.contract_acceptance_audit_events
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS contract_audit_events_no_direct_delete
  ON public.contract_acceptance_audit_events;
CREATE POLICY contract_audit_events_no_direct_delete
ON public.contract_acceptance_audit_events
FOR DELETE TO authenticated USING (false);

-- ---------------------------------------------------------------------------
-- 4) Storage: PDFs de aceite
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-acceptance-pdfs',
  'contract-acceptance-pdfs',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "contract_acceptance_pdfs_admin_all" ON storage.objects;
CREATE POLICY "contract_acceptance_pdfs_admin_all"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'contract-acceptance-pdfs'
  AND public.user_is_admin_master_for_rls()
)
WITH CHECK (
  bucket_id = 'contract-acceptance-pdfs'
  AND public.user_is_admin_master_for_rls()
);

DROP POLICY IF EXISTS "contract_acceptance_pdfs_manager_select" ON storage.objects;
CREATE POLICY "contract_acceptance_pdfs_manager_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'contract-acceptance-pdfs'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
        AND uc.company_id::text = (storage.foldername(name))[1]
    )
  )
);

-- ---------------------------------------------------------------------------
-- 5) Helpers OTP / auditoria
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hash_contract_acceptance_otp(p_code TEXT, p_salt TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(COALESCE(p_code, '') || ':' || COALESCE(p_salt, ''), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.mask_email_for_otp(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_at INT;
  v_local TEXT;
  v_domain TEXT;
BEGIN
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RETURN '***';
  END IF;
  v_at := position('@' IN v_email);
  v_local := left(v_email, v_at - 1);
  v_domain := substring(v_email FROM v_at + 1);
  IF length(v_local) <= 2 THEN
    RETURN left(v_local, 1) || '***@' || v_domain;
  END IF;
  RETURN left(v_local, 2) || '***@' || v_domain;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_contract_acceptance_audit_event(
  p_event_type TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_acceptance_id UUID DEFAULT NULL,
  p_challenge_id UUID DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_contract_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_event_type IS NULL OR trim(p_event_type) = '' THEN
    RAISE EXCEPTION 'event_type obrigatório.';
  END IF;

  INSERT INTO public.contract_acceptance_audit_events (
    event_type,
    actor_user_id,
    acceptance_id,
    challenge_id,
    company_id,
    contract_id,
    payload
  ) VALUES (
    trim(p_event_type),
    COALESCE(p_actor_user_id, auth.uid()),
    p_acceptance_id,
    p_challenge_id,
    p_company_id,
    p_contract_id,
    COALESCE(p_payload, '{}'::jsonb)
      - 'code'
      - 'otp'
      - 'otp_code'
      - 'token'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_contract_acceptance_audit_event(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_contract_acceptance_audit_event(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_contract_acceptance_audit_event(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) register_contract_acceptance: APPEND-ONLY (+ evidências opcionais)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_contract_acceptance(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB);

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
    user_id,
    company_id,
    contract_id,
    contract_version,
    contract_type,
    accepted_at,
    contract_title_snapshot,
    content_snapshot,
    content_hash,
    acceptance_source,
    accepted_ip,
    user_agent,
    scrolled_to_end,
    metadata,
    party_snapshot,
    commercial_terms_snapshot,
    presented_document_text,
    document_hash,
    verification_method,
    verification_channel,
    verified_at,
    pdf_storage_path,
    pdf_generated_at,
    idempotency_key,
    otp_challenge_id
  ) VALUES (
    v_target_user,
    p_company_id,
    v_contract.id,
    v_contract.version,
    v_contract.contract_type,
    v_now,
    v_contract.title,
    v_contract.content,
    v_hash,
    NULLIF(trim(p_acceptance_source), ''),
    NULLIF(trim(p_accepted_ip), ''),
    NULLIF(left(trim(COALESCE(p_user_agent, '')), 2000), ''),
    p_scrolled_to_end,
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_party_snapshot, '{}'::jsonb),
    COALESCE(p_commercial_terms_snapshot, '{}'::jsonb),
    v_presented,
    v_doc_hash,
    NULLIF(trim(COALESCE(p_verification_method, '')), ''),
    NULLIF(trim(COALESCE(p_verification_channel, '')), ''),
    p_verified_at,
    NULLIF(trim(COALESCE(p_pdf_storage_path, '')), ''),
    p_pdf_generated_at,
    NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
    p_otp_challenge_id
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
  END IF;

  PERFORM public.log_contract_acceptance_audit_event(
    'acceptance_created',
    v_target_user,
    v_acceptance_id,
    p_otp_challenge_id,
    p_company_id,
    v_contract.id,
    jsonb_build_object(
      'acceptance_source', NULLIF(trim(p_acceptance_source), ''),
      'verification_method', NULLIF(trim(COALESCE(p_verification_method, '')), ''),
      'document_hash', v_doc_hash
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

REVOKE ALL ON FUNCTION public.register_contract_acceptance(
  UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB,
  JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_contract_acceptance(
  UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB,
  JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT, UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.register_contract_acceptance(
  UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB,
  JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT, UUID
) TO service_role;

-- ---------------------------------------------------------------------------
-- 8) Relatório admin: expor novos campos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_admin_company_contract_acceptances(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company JSONB;
  v_items JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa não informada.';
  END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'corporate_name', c.corporate_name,
    'trade_name', c.trade_name,
    'cnpj', c.cnpj,
    'billing_plan', c.billing_plan::text,
    'billing_plan_accepted_at', c.billing_plan_accepted_at,
    'billing_contract_id', c.billing_contract_id,
    'contract_version_accepted_id', c.contract_version_accepted_id,
    'requires_billing_reacceptance', c.requires_billing_reacceptance
  )
  INTO v_company
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.accepted_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ca.id,
      ca.user_id,
      u.email AS user_email,
      trim(concat_ws(' ', p.first_name, p.last_name)) AS user_name,
      ca.company_id,
      ca.contract_id,
      ca.contract_version,
      ca.contract_type,
      ca.accepted_at,
      ca.contract_title_snapshot,
      ca.content_hash,
      ca.document_hash,
      ca.acceptance_source,
      ca.accepted_ip,
      ca.user_agent,
      ca.scrolled_to_end,
      ca.metadata,
      ca.party_snapshot,
      ca.commercial_terms_snapshot,
      ca.verification_method,
      ca.verification_channel,
      ca.verified_at,
      ca.pdf_storage_path,
      ca.pdf_generated_at,
      ca.idempotency_key,
      ec.version AS current_contract_version,
      ec.is_active AS current_contract_is_active,
      length(COALESCE(ca.content_snapshot, '')) AS content_snapshot_length,
      ca.content_snapshot,
      length(COALESCE(ca.presented_document_text, '')) AS presented_document_length
    FROM public.contract_acceptances ca
    LEFT JOIN auth.users u ON u.id = ca.user_id
    LEFT JOIN public.profiles p ON p.id = ca.user_id
    LEFT JOIN public.event_contracts ec ON ec.id = ca.contract_id
    WHERE ca.company_id = p_company_id
       OR (
         ca.user_id IN (
           SELECT uc.user_id FROM public.user_companies uc WHERE uc.company_id = p_company_id
         )
       )
    ORDER BY ca.accepted_at DESC
  ) t;

  RETURN jsonb_build_object(
    'company', v_company,
    'items', v_items,
    'total', COALESCE(jsonb_array_length(v_items), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_company_contract_acceptances(UUID) TO authenticated;
