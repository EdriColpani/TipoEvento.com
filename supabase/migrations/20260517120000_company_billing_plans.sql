-- Planos de cobrança por empresa (Fase 1A + 1B)
-- Pode rodar em bancos sem migrations anteriores de contratos (bootstrap mínimo abaixo).

DO $$ BEGIN
  CREATE TYPE public.billing_plan_type AS ENUM (
    'listing_monthly',
    'ticket_commission',
    'ticket_plus_consumption',
    'consumption_or_license'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Função usada nas policies (normalmente em 20260322000001_user_companies_companies_rls_gestor.sql)
CREATE OR REPLACE FUNCTION public.user_is_admin_master_for_rls()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 1
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_admin_master_for_rls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_admin_master_for_rls() TO authenticated;

-- Bootstrap mínimo: event_contracts + contract_acceptances (sem FK inline em companies)
CREATE TABLE IF NOT EXISTS public.event_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(20) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  contract_type TEXT NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.event_contracts
  ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'other';

-- Índice único: não força version sozinha (banco pode ter 1.1 em tipos diferentes).
-- Padrão do projeto: idx_event_contracts_version_type_unique (20260319000015).
DO $$
BEGIN
  IF to_regclass('public.event_contracts') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_event_contracts_version_type_unique'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.event_contracts
    GROUP BY version, contract_type
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX idx_event_contracts_version_type_unique
      ON public.event_contracts (version, contract_type);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.contract_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.event_contracts(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  contract_version TEXT NOT NULL,
  contract_type TEXT NOT NULL
);

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS billing_plan public.billing_plan_type,
  ADD COLUMN IF NOT EXISTS billing_plan_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_plan_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requires_billing_reacceptance BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS billing_contract_id UUID;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contract_version_accepted_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'companies'
      AND constraint_name = 'companies_billing_contract_id_fkey'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_billing_contract_id_fkey
      FOREIGN KEY (billing_contract_id) REFERENCES public.event_contracts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'companies'
      AND constraint_name = 'companies_contract_version_accepted_id_fkey'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_contract_version_accepted_id_fkey
      FOREIGN KEY (contract_version_accepted_id) REFERENCES public.event_contracts(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.companies.billing_plan IS 'Modelo comercial único da empresa.';
COMMENT ON COLUMN public.companies.requires_billing_reacceptance IS 'true quando admin publica nova versão de contrato do plano.';

-- Empresas existentes: plano padrão; exigem confirmação/aceite na UI
UPDATE public.companies
SET
  billing_plan = 'ticket_commission'::public.billing_plan_type,
  requires_billing_reacceptance = true
WHERE billing_plan IS NULL;

CREATE TABLE IF NOT EXISTS public.company_billing_plan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  from_plan public.billing_plan_type,
  to_plan public.billing_plan_type NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('initial', 'reacceptance', 'upgrade', 'admin_change', 'admin_downgrade')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_company_billing_plan_history_company
  ON public.company_billing_plan_history(company_id, created_at DESC);

ALTER TABLE public.company_billing_plan_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_billing_history_select" ON public.company_billing_plan_history;
CREATE POLICY "company_billing_history_select"
  ON public.company_billing_plan_history
  FOR SELECT
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_billing_plan_history.company_id
        AND uc.user_id = auth.uid()
    )
  );

-- Nível do plano (upgrade = rank maior)
CREATE OR REPLACE FUNCTION public.billing_plan_rank(p_plan public.billing_plan_type)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_plan
    WHEN 'listing_monthly' THEN 1
    WHEN 'ticket_commission' THEN 2
    WHEN 'ticket_plus_consumption' THEN 3
    WHEN 'consumption_or_license' THEN 4
    ELSE 0
  END;
$$;

-- Gestor é membro da empresa ou admin master
CREATE OR REPLACE FUNCTION public.user_can_manage_company_billing(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = p_company_id
        AND uc.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_manage_company_billing(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_manage_company_billing(UUID) TO authenticated;

-- Planos disponíveis para o gestor na v1
CREATE OR REPLACE FUNCTION public.billing_plan_selectable_by_gestor(p_plan public.billing_plan_type)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_plan IN ('listing_monthly'::public.billing_plan_type, 'ticket_commission'::public.billing_plan_type);
$$;

CREATE OR REPLACE FUNCTION public._register_company_billing_acceptance(
  p_company_id UUID,
  p_contract_id UUID,
  p_contract_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract RECORD;
BEGIN
  SELECT id, version, contract_type, is_active
  INTO v_contract
  FROM public.event_contracts
  WHERE id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  DELETE FROM public.contract_acceptances
  WHERE company_id = p_company_id
    AND contract_type = p_contract_type;

  INSERT INTO public.contract_acceptances (
    user_id,
    company_id,
    contract_id,
    contract_version,
    contract_type
  ) VALUES (
    auth.uid(),
    p_company_id,
    v_contract.id,
    v_contract.version,
    v_contract.contract_type
  );
END;
$$;

-- Confirma plano atual + aceite de contrato (primeira vez, reaceite ou troca inicial)
CREATE OR REPLACE FUNCTION public.confirm_company_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type,
  p_contract_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_contract RECORD;
  v_change_type TEXT;
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano desta empresa.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND NOT public.billing_plan_selectable_by_gestor(p_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível. Entre em contato com o suporte.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT id, version, contract_type INTO v_contract
  FROM public.event_contracts WHERE id = p_contract_id;
  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  -- Gestor: não pode mudar de plano aqui se já tem plano e é upgrade (use RPC de upgrade)
  IF NOT public.user_is_admin_master_for_rls()
     AND v_company.billing_plan IS NOT NULL
     AND v_company.billing_plan IS DISTINCT FROM p_plan
     AND public.billing_plan_rank(p_plan) > public.billing_plan_rank(v_company.billing_plan) THEN
    RAISE EXCEPTION 'Para mudar para um plano superior, use a opção de upgrade no perfil da empresa.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND v_company.billing_plan IS NOT NULL
     AND v_company.billing_plan IS DISTINCT FROM p_plan
     AND public.billing_plan_rank(p_plan) < public.billing_plan_rank(v_company.billing_plan) THEN
    RAISE EXCEPTION 'Downgrade de plano só pode ser feito pelo administrador do sistema.';
  END IF;

  IF v_company.billing_plan IS NULL THEN
    v_change_type := 'initial';
  ELSIF v_company.requires_billing_reacceptance
        OR v_company.billing_contract_id IS DISTINCT FROM p_contract_id THEN
    v_change_type := 'reacceptance';
  ELSE
    v_change_type := 'reacceptance';
  END IF;

  UPDATE public.companies
  SET
    billing_plan = p_plan,
    billing_contract_id = p_contract_id,
    billing_plan_accepted_at = timezone('utc'::text, now()),
    requires_billing_reacceptance = false,
    contract_version_accepted_id = p_contract_id
  WHERE id = p_company_id;

  PERFORM public._register_company_billing_acceptance(
    p_company_id,
    p_contract_id,
    v_contract.contract_type
  );

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    p_plan,
    auth.uid(),
    v_change_type
  );

  RETURN jsonb_build_object(
    'success', true,
    'billing_plan', p_plan,
    'change_type', v_change_type
  );
END;
$$;

-- Upgrade automático (gestor) com cooldown de 90 dias
CREATE OR REPLACE FUNCTION public.request_company_billing_plan_upgrade(
  p_company_id UUID,
  p_new_plan public.billing_plan_type,
  p_contract_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_contract RECORD;
  v_cooldown_days CONSTANT INTEGER := 90;
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano desta empresa.';
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
  ELSIF NOT public.billing_plan_selectable_by_gestor(p_new_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF v_company.billing_plan IS NULL THEN
    RAISE EXCEPTION 'Confirme primeiro o plano atual antes de fazer upgrade.';
  END IF;

  IF public.billing_plan_rank(p_new_plan) <= public.billing_plan_rank(v_company.billing_plan) THEN
    RAISE EXCEPTION 'Apenas upgrade para plano superior é permitido. Para reduzir o plano, contate o administrador.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls()
     AND v_company.billing_plan_locked_until IS NOT NULL
     AND v_company.billing_plan_locked_until > timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'Upgrade disponível após %', to_char(v_company.billing_plan_locked_until, 'DD/MM/YYYY');
  END IF;

  SELECT id, contract_type INTO v_contract FROM public.event_contracts WHERE id = p_contract_id;
  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  UPDATE public.companies
  SET
    billing_plan = p_new_plan,
    billing_contract_id = p_contract_id,
    billing_plan_accepted_at = timezone('utc'::text, now()),
    requires_billing_reacceptance = false,
    contract_version_accepted_id = p_contract_id,
    billing_plan_locked_until = CASE
      WHEN public.user_is_admin_master_for_rls() THEN billing_plan_locked_until
      ELSE timezone('utc'::text, now()) + (v_cooldown_days || ' days')::interval
    END
  WHERE id = p_company_id;

  PERFORM public._register_company_billing_acceptance(
    p_company_id,
    p_contract_id,
    v_contract.contract_type
  );

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    p_new_plan,
    auth.uid(),
    'upgrade'
  );

  RETURN jsonb_build_object('success', true, 'billing_plan', p_new_plan);
END;
$$;

-- Admin: qualquer alteração de plano (inclui downgrade)
CREATE OR REPLACE FUNCTION public.admin_set_company_billing_plan(
  p_company_id UUID,
  p_plan public.billing_plan_type,
  p_contract_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_contract RECORD;
  v_change_type TEXT;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode usar esta função.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF p_contract_id IS NOT NULL THEN
    SELECT id, contract_type INTO v_contract FROM public.event_contracts WHERE id = p_contract_id;
    IF v_contract.id IS NULL THEN
      RAISE EXCEPTION 'Contrato não encontrado.';
    END IF;
    PERFORM public._register_company_billing_acceptance(
      p_company_id,
      p_contract_id,
      v_contract.contract_type
    );
  END IF;

  IF v_company.billing_plan IS NOT NULL
     AND public.billing_plan_rank(p_plan) < public.billing_plan_rank(v_company.billing_plan) THEN
    v_change_type := 'admin_downgrade';
  ELSE
    v_change_type := 'admin_change';
  END IF;

  UPDATE public.companies
  SET
    billing_plan = p_plan,
    billing_contract_id = COALESCE(p_contract_id, billing_contract_id),
    billing_plan_accepted_at = CASE WHEN p_contract_id IS NOT NULL THEN timezone('utc'::text, now()) ELSE billing_plan_accepted_at END,
    requires_billing_reacceptance = false,
    contract_version_accepted_id = COALESCE(p_contract_id, contract_version_accepted_id)
  WHERE id = p_company_id;

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    p_company_id,
    v_company.billing_plan,
    p_plan,
    auth.uid(),
    v_change_type
  );

  RETURN jsonb_build_object('success', true, 'billing_plan', p_plan);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_company_billing_plan(UUID, public.billing_plan_type, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_company_billing_plan_upgrade(UUID, public.billing_plan_type, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_company_billing_plan(UUID, public.billing_plan_type, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.confirm_company_billing_plan(UUID, public.billing_plan_type, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_company_billing_plan_upgrade(UUID, public.billing_plan_type, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_billing_plan(UUID, public.billing_plan_type, UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.billing_plan_rank(public.billing_plan_type) TO authenticated;
