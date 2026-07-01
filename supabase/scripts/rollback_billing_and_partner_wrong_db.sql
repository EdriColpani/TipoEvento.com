-- =============================================================================
-- ROLLBACK MANUAL — NÃO rodar via `supabase db push`
--
-- Desfaz o que foi aplicado por engano nestes 3 arquivos (ordem inversa):
--   1) 20260727120000_partner_companies.sql
--   2) 20260523120000_billing_plan_features.sql
--   3) 20260517120000_company_billing_plans.sql
--
-- Execute no SQL Editor do banco ERRADO (não no banco de produção correto).
-- Revise as seções OPCIONAL antes de rodar.
-- =============================================================================

BEGIN;

-- =============================================================================
-- OPCIONAL: dados criados por engano (descomente se aplicável)
-- =============================================================================
-- DELETE FROM public.companies
-- WHERE company_kind = 'partner'::public.company_kind;

-- =============================================================================
-- FASE 1 — Reverter 20260727120000_partner_companies.sql
-- =============================================================================

-- Funções exclusivas da migration de parceiros
DROP FUNCTION IF EXISTS public.admin_create_partner_company(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.list_company_members(UUID);
DROP FUNCTION IF EXISTS public.invite_company_member(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.accept_company_member_invites();
DROP FUNCTION IF EXISTS public.user_manages_credit_establishments(UUID, UUID);
DROP FUNCTION IF EXISTS public.user_operates_credit_pdv(UUID, UUID);
DROP FUNCTION IF EXISTS public.user_owns_company(UUID, UUID);
DROP FUNCTION IF EXISTS public.user_company_role(UUID, UUID);
DROP FUNCTION IF EXISTS public.user_company_role(UUID);

-- Convites
DROP POLICY IF EXISTS company_member_invites_admin_all ON public.company_member_invites;
DROP POLICY IF EXISTS company_member_invites_owner_select ON public.company_member_invites;
DROP TABLE IF EXISTS public.company_member_invites CASCADE;

-- Reverter UPDATE em billing_plan_features (só se a tabela existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'billing_plan_features'
  ) THEN
    UPDATE public.billing_plan_features
    SET enabled = true, updated_at = timezone('utc'::text, now())
    WHERE billing_plan = 'consumption_or_license'::public.billing_plan_type
      AND feature_key IN (
        'wristbands',
        'validation_keys',
        'reports_financial',
        'reports_sales',
        'reports_wristband_movements',
        'reports_audience'
      );
  END IF;
END $$;

-- Restaurar funções de crédito sobrescritas pela migration de parceiros
-- (somente se o módulo de créditos já existia no banco)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'credit_establishments'
  ) THEN
    CREATE OR REPLACE FUNCTION public.user_manages_credit_company(
      p_company_id UUID,
      p_user_id UUID DEFAULT auth.uid()
    )
    RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT
        public.user_is_admin_master_for_rls()
        OR EXISTS (
          SELECT 1
          FROM public.user_companies uc
          WHERE uc.company_id = p_company_id
            AND uc.user_id = p_user_id
        );
    $fn$;

    CREATE OR REPLACE FUNCTION public.save_credit_establishment(
      p_company_id UUID,
      p_name TEXT,
      p_event_id UUID DEFAULT NULL,
      p_establishment_id UUID DEFAULT NULL,
      p_credit_acceptance_enabled BOOLEAN DEFAULT true,
      p_active BOOLEAN DEFAULT true
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    DECLARE
      v_id UUID;
      v_name TEXT;
    BEGIN
      IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'Empresa inválida.';
      END IF;

      IF NOT public.user_manages_credit_company(p_company_id) THEN
        RAISE EXCEPTION 'Sem permissão.';
      END IF;

      IF NOT public.credit_module_globally_enabled() THEN
        RAISE EXCEPTION 'Módulo de créditos EventFest indisponível.';
      END IF;

      IF NOT public.company_allows_credit_consumption(p_company_id) THEN
        RAISE EXCEPTION 'Plano comercial da empresa não habilita consumo por crédito.';
      END IF;

      v_name := trim(COALESCE(p_name, ''));
      IF v_name = '' THEN
        RAISE EXCEPTION 'Informe o nome do estabelecimento.';
      END IF;

      IF p_event_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id = p_event_id AND e.company_id = p_company_id
        ) THEN
          RAISE EXCEPTION 'Evento inválido para esta empresa.';
        END IF;
      END IF;

      IF p_establishment_id IS NOT NULL THEN
        UPDATE public.credit_establishments ce
        SET
          name = v_name,
          event_id = p_event_id,
          credit_acceptance_enabled = COALESCE(p_credit_acceptance_enabled, true),
          active = COALESCE(p_active, true)
        WHERE ce.id = p_establishment_id
          AND ce.company_id = p_company_id
        RETURNING ce.id INTO v_id;

        IF v_id IS NULL THEN
          RAISE EXCEPTION 'Estabelecimento não encontrado.';
        END IF;
      ELSE
        INSERT INTO public.credit_establishments (
          company_id, event_id, name, credit_acceptance_enabled, active
        ) VALUES (
          p_company_id, p_event_id, v_name,
          COALESCE(p_credit_acceptance_enabled, true),
          COALESCE(p_active, true)
        )
        RETURNING id INTO v_id;
      END IF;

      RETURN jsonb_build_object('ok', true, 'establishment_id', v_id);
    END;
    $fn$;

    CREATE OR REPLACE FUNCTION public.set_credit_establishment_active(
      p_establishment_id UUID,
      p_company_id UUID,
      p_active BOOLEAN
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    BEGIN
      IF p_establishment_id IS NULL OR p_company_id IS NULL THEN
        RAISE EXCEPTION 'Parâmetros inválidos.';
      END IF;

      IF NOT public.user_manages_credit_company(p_company_id) THEN
        RAISE EXCEPTION 'Sem permissão.';
      END IF;

      UPDATE public.credit_establishments
      SET active = COALESCE(p_active, false)
      WHERE id = p_establishment_id
        AND company_id = p_company_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Estabelecimento não encontrado.';
      END IF;

      RETURN jsonb_build_object('ok', true, 'active', COALESCE(p_active, false));
    END;
    $fn$;
  ELSE
    -- Banco sem módulo de créditos: remove funções criadas/sobrescritas pela migration
    DROP FUNCTION IF EXISTS public.save_credit_establishment(UUID, TEXT, UUID, UUID, BOOLEAN, BOOLEAN);
    DROP FUNCTION IF EXISTS public.set_credit_establishment_active(UUID, UUID, BOOLEAN);
    DROP FUNCTION IF EXISTS public.user_manages_credit_company(UUID, UUID);
  END IF;
END $$;

-- Colunas e tipo de parceiros
ALTER TABLE public.user_companies
  DROP CONSTRAINT IF EXISTS user_companies_role_check;

ALTER TABLE public.user_companies
  DROP COLUMN IF EXISTS role;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS company_kind;

DROP TYPE IF EXISTS public.company_kind;

-- =============================================================================
-- FASE 2 — Reverter 20260523120000_billing_plan_features.sql
-- =============================================================================

DROP POLICY IF EXISTS "billing_plan_features_admin_all" ON public.billing_plan_features;
DROP POLICY IF EXISTS "billing_plan_features_select_authenticated" ON public.billing_plan_features;
DROP TABLE IF EXISTS public.billing_plan_features CASCADE;

DROP FUNCTION IF EXISTS public.admin_save_billing_plan_features(JSONB);
DROP FUNCTION IF EXISTS public.admin_get_billing_plan_features_matrix();
DROP FUNCTION IF EXISTS public.assert_company_plan_feature(UUID, TEXT);
DROP FUNCTION IF EXISTS public.company_has_plan_feature(UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_company_plan_features(UUID);
DROP FUNCTION IF EXISTS public._billing_plan_features_map(public.billing_plan_type);

-- =============================================================================
-- FASE 3 — Reverter 20260517120000_company_billing_plans.sql
-- =============================================================================

DROP POLICY IF EXISTS "company_billing_history_select" ON public.company_billing_plan_history;
DROP TABLE IF EXISTS public.company_billing_plan_history CASCADE;

DROP FUNCTION IF EXISTS public.admin_set_company_billing_plan(UUID, public.billing_plan_type, UUID);
DROP FUNCTION IF EXISTS public.request_company_billing_plan_upgrade(UUID, public.billing_plan_type, UUID);
DROP FUNCTION IF EXISTS public.confirm_company_billing_plan(UUID, public.billing_plan_type, UUID);
DROP FUNCTION IF EXISTS public._register_company_billing_acceptance(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.billing_plan_selectable_by_gestor(public.billing_plan_type);
DROP FUNCTION IF EXISTS public.user_can_manage_company_billing(UUID);
DROP FUNCTION IF EXISTS public.billing_plan_rank(public.billing_plan_type);

-- FKs e colunas em companies
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_billing_contract_id_fkey;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_contract_version_accepted_id_fkey;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS billing_plan,
  DROP COLUMN IF EXISTS billing_plan_accepted_at,
  DROP COLUMN IF EXISTS billing_plan_locked_until,
  DROP COLUMN IF EXISTS requires_billing_reacceptance,
  DROP COLUMN IF EXISTS billing_contract_id;

-- contract_version_accepted_id: a migration 20260319000013 também adiciona esta coluna.
-- Só remove se profiles NÃO tiver a mesma coluna (indica que veio só do bootstrap desta migration).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'contract_version_accepted_id'
  ) THEN
    ALTER TABLE public.companies
      DROP COLUMN IF EXISTS contract_version_accepted_id;
  ELSE
    RAISE NOTICE 'companies.contract_version_accepted_id mantida (migration 20260319000013 pode tê-la criado).';
  END IF;
END $$;

-- Enum billing_plan_type (CASCADE remove funções que ainda dependam dele, ex. company_allows_credit_consumption)
DROP TYPE IF EXISTS public.billing_plan_type CASCADE;

-- Bootstrap de contratos: só remove se as tabelas estiverem VAZIAS
-- (criadas pelo bootstrap desta migration em banco que não tinha contratos antes)
DO $$
DECLARE
  v_contracts_count BIGINT := 0;
  v_acceptances_count BIGINT := 0;
BEGIN
  IF to_regclass('public.event_contracts') IS NOT NULL THEN
    SELECT count(*) INTO v_contracts_count FROM public.event_contracts;
  END IF;

  IF to_regclass('public.contract_acceptances') IS NOT NULL THEN
    SELECT count(*) INTO v_acceptances_count FROM public.contract_acceptances;
  END IF;

  IF v_contracts_count = 0 AND v_acceptances_count = 0 THEN
    DROP TABLE IF EXISTS public.contract_acceptances CASCADE;
    DROP TABLE IF EXISTS public.event_contracts CASCADE;
    RAISE NOTICE 'event_contracts e contract_acceptances removidos (estavam vazios).';
  ELSE
    RAISE NOTICE 'event_contracts (%) / contract_acceptances (%) com dados — NÃO removidos.',
      v_contracts_count, v_acceptances_count;
  END IF;
END $$;

-- NÃO remove user_is_admin_master_for_rls() — usada por outras partes do sistema.

COMMIT;

-- =============================================================================
-- Verificação rápida (deve retornar NULL / 0 linhas):
-- =============================================================================
-- SELECT to_regclass('public.billing_plan_features');
-- SELECT to_regclass('public.company_billing_plan_history');
-- SELECT to_regclass('public.company_member_invites');
-- SELECT typname FROM pg_type WHERE typname IN ('billing_plan_type', 'company_kind');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'companies'
--     AND column_name IN ('billing_plan', 'company_kind', 'billing_contract_id');
