-- Recebimento opcional: Mercado Pago (split) OU conta bancária/PIX (D+1 manual para ingressos).
-- Gate de criação de evento exige setup válido. Ledger D+1 de ingresso espelha o de crédito.

-- =============================================================================
-- 1) Perfil de recebimento da empresa
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_payout_profiles (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  payout_mode TEXT NOT NULL DEFAULT 'mercado_pago'
    CHECK (payout_mode IN ('mercado_pago', 'bank_transfer')),
  bank_code TEXT,
  bank_name TEXT,
  agency TEXT,
  account_number TEXT,
  account_digit TEXT,
  account_type TEXT
    CHECK (account_type IS NULL OR account_type IN ('checking', 'savings')),
  holder_name TEXT,
  holder_document TEXT,
  pix_key TEXT,
  pix_key_type TEXT
    CHECK (pix_key_type IS NULL OR pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.company_payout_profiles IS
  'Modo de recebimento da empresa: split MP ou repasse D+1 via PIX/TED com dados bancários.';

ALTER TABLE public.company_payout_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_payout_profiles_select ON public.company_payout_profiles;
CREATE POLICY company_payout_profiles_select ON public.company_payout_profiles
  FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(company_id, auth.uid())
  );

DROP POLICY IF EXISTS company_payout_profiles_write ON public.company_payout_profiles;
CREATE POLICY company_payout_profiles_write ON public.company_payout_profiles
  FOR ALL TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(company_id, auth.uid())
  )
  WITH CHECK (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(company_id, auth.uid())
  );

GRANT SELECT, INSERT, UPDATE ON public.company_payout_profiles TO authenticated;
GRANT ALL ON public.company_payout_profiles TO service_role;

-- Colunas de canal no receivable (ingresso)
ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS settlement_channel TEXT,
  ADD COLUMN IF NOT EXISTS collector_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receivables_settlement_channel_check'
  ) THEN
    ALTER TABLE public.receivables
      ADD CONSTRAINT receivables_settlement_channel_check
      CHECK (
        settlement_channel IS NULL
        OR settlement_channel IN ('mp_split', 'manual_d1')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receivables_collector_type_check'
  ) THEN
    ALTER TABLE public.receivables
      ADD CONSTRAINT receivables_collector_type_check
      CHECK (
        collector_type IS NULL
        OR collector_type IN ('manager', 'platform')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.receivables.settlement_channel IS
  'mp_split = líquido na conta MP do gestor; manual_d1 = EventFest cobra e repassa D+1.';
COMMENT ON COLUMN public.receivables.collector_type IS
  'Conta MP que cobrou: manager (split) ou platform (EventFest).';

-- =============================================================================
-- 2) Helpers: MP do gestor + validação de payout
-- =============================================================================

CREATE OR REPLACE FUNCTION public.company_manager_has_mp_configured(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN := false;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.payment_settings ps
    WHERE (
        ps.company_id = p_company_id
        OR ps.user_id IN (
          SELECT uc.user_id FROM public.user_companies uc WHERE uc.company_id = p_company_id
        )
      )
      AND (
        (ps.api_token_ciphertext IS NOT NULL AND length(trim(ps.api_token_ciphertext)) > 0)
        OR COALESCE(ps.mp_connection_source, '') = 'oauth'
      )
  )
  INTO v_ok;

  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_payout_bank_fields_complete(
  p_bank_code TEXT,
  p_bank_name TEXT,
  p_agency TEXT,
  p_account_number TEXT,
  p_holder_name TEXT,
  p_holder_document TEXT,
  p_pix_key TEXT,
  p_pix_key_type TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    NULLIF(trim(COALESCE(p_bank_code, '')), '') IS NOT NULL
    AND NULLIF(trim(COALESCE(p_bank_name, '')), '') IS NOT NULL
    AND NULLIF(trim(COALESCE(p_agency, '')), '') IS NOT NULL
    AND NULLIF(trim(COALESCE(p_account_number, '')), '') IS NOT NULL
    AND NULLIF(trim(COALESCE(p_holder_name, '')), '') IS NOT NULL
    AND NULLIF(trim(COALESCE(p_holder_document, '')), '') IS NOT NULL
    AND NULLIF(trim(COALESCE(p_pix_key, '')), '') IS NOT NULL
    AND NULLIF(trim(COALESCE(p_pix_key_type, '')), '') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.company_has_valid_payout_setup(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_kind TEXT;
  v_mode TEXT;
  v_row public.company_payout_profiles%ROWTYPE;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT c.billing_plan::text, COALESCE(c.company_kind::text, 'organizer')
  INTO v_plan, v_kind
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Planos sem venda de ingresso pela plataforma: não exigem payout de ingresso
  IF v_plan IN ('listing_monthly', 'consumption_or_license') AND v_kind <> 'partner' THEN
    RETURN true;
  END IF;

  SELECT * INTO v_row
  FROM public.company_payout_profiles p
  WHERE p.company_id = p_company_id;

  -- Parceira: sempre precisa de dados bancários (recebe D+1 de consumo)
  IF v_kind = 'partner' THEN
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    RETURN public.company_payout_bank_fields_complete(
      v_row.bank_code, v_row.bank_name, v_row.agency, v_row.account_number,
      v_row.holder_name, v_row.holder_document, v_row.pix_key, v_row.pix_key_type
    );
  END IF;

  -- Organizador com plano de ingresso
  IF v_plan IN ('ticket_commission', 'ticket_plus_consumption') THEN
    IF NOT FOUND THEN
      -- Legado: só MP conectado, ainda sem escolher modo no perfil
      RETURN public.company_manager_has_mp_configured(p_company_id);
    END IF;
    v_mode := v_row.payout_mode;
    IF v_mode = 'mercado_pago' THEN
      RETURN public.company_manager_has_mp_configured(p_company_id);
    END IF;
    IF v_mode = 'bank_transfer' THEN
      RETURN public.company_payout_bank_fields_complete(
        v_row.bank_code, v_row.bank_name, v_row.agency, v_row.account_number,
        v_row.holder_name, v_row.holder_document, v_row.pix_key, v_row.pix_key_type
      );
    END IF;
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_company_payout_setup_for_events(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN;
  END IF;

  IF p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.billing_plan::text INTO v_plan
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_plan NOT IN ('ticket_commission', 'ticket_plus_consumption') THEN
    RETURN;
  END IF;

  IF NOT public.company_has_valid_payout_setup(p_company_id) THEN
    RAISE EXCEPTION
      'Cadastro de eventos bloqueado: configure o recebimento em Perfil da Empresa → Recebimento (Mercado Pago ou conta bancária/PIX). Caminho: /manager/settings/company-profile?tab=payments';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_payout_profile(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.company_payout_profiles%ROWTYPE;
  v_mp_ok BOOLEAN;
  v_valid BOOLEAN;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(p_company_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT * INTO v_row
  FROM public.company_payout_profiles
  WHERE company_id = p_company_id;

  v_mp_ok := public.company_manager_has_mp_configured(p_company_id);
  v_valid := public.company_has_valid_payout_setup(p_company_id);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'company_id', p_company_id,
      'exists', false,
      'payout_mode', NULL,
      'mp_configured', v_mp_ok,
      'setup_valid', v_valid,
      'bank', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'exists', true,
    'payout_mode', v_row.payout_mode,
    'mp_configured', v_mp_ok,
    'setup_valid', v_valid,
    'updated_at', v_row.updated_at,
    'bank', jsonb_build_object(
      'bank_code', v_row.bank_code,
      'bank_name', v_row.bank_name,
      'agency', v_row.agency,
      'account_number', v_row.account_number,
      'account_digit', v_row.account_digit,
      'account_type', v_row.account_type,
      'holder_name', v_row.holder_name,
      'holder_document', v_row.holder_document,
      'pix_key', v_row.pix_key,
      'pix_key_type', v_row.pix_key_type
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_company_payout_profile(
  p_company_id UUID,
  p_payout_mode TEXT,
  p_bank_code TEXT DEFAULT NULL,
  p_bank_name TEXT DEFAULT NULL,
  p_agency TEXT DEFAULT NULL,
  p_account_number TEXT DEFAULT NULL,
  p_account_digit TEXT DEFAULT NULL,
  p_account_type TEXT DEFAULT NULL,
  p_holder_name TEXT DEFAULT NULL,
  p_holder_document TEXT DEFAULT NULL,
  p_pix_key TEXT DEFAULT NULL,
  p_pix_key_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_kind TEXT;
  v_active_paid INTEGER := 0;
  v_old_mode TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(p_company_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(c.company_kind::text, 'organizer') INTO v_kind
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  v_mode := lower(trim(COALESCE(p_payout_mode, '')));
  IF v_kind = 'partner' THEN
    v_mode := 'bank_transfer';
  END IF;

  IF v_mode NOT IN ('mercado_pago', 'bank_transfer') THEN
    RAISE EXCEPTION 'Modo de recebimento inválido. Use mercado_pago ou bank_transfer.';
  END IF;

  SELECT p.payout_mode INTO v_old_mode
  FROM public.company_payout_profiles p
  WHERE p.company_id = p_company_id;

  -- Bloquear troca MP → banco com eventos pagos ativos (exceto Admin Master)
  IF v_old_mode = 'mercado_pago'
     AND v_mode = 'bank_transfer'
     AND NOT public.user_is_admin_master_for_rls() THEN
    SELECT COUNT(*)::integer INTO v_active_paid
    FROM public.events e
    WHERE e.company_id = p_company_id
      AND COALESCE(e.is_active, false) = true
      AND COALESCE(e.is_paid, false) = true;

    IF COALESCE(v_active_paid, 0) > 0 THEN
      RAISE EXCEPTION
        'Não é possível trocar para conta bancária enquanto houver eventos pagos ativos. Desative os eventos ou peça ao Admin Master.';
    END IF;
  END IF;

  IF v_mode = 'mercado_pago' THEN
    IF NOT public.company_manager_has_mp_configured(p_company_id) THEN
      RAISE EXCEPTION
        'Conecte a conta Mercado Pago em Perfil da Empresa → Recebimento antes de salvar o modo Mercado Pago.';
    END IF;
  ELSE
    IF NOT public.company_payout_bank_fields_complete(
      p_bank_code, p_bank_name, p_agency, p_account_number,
      p_holder_name, p_holder_document, p_pix_key, p_pix_key_type
    ) THEN
      RAISE EXCEPTION
        'Para receber via banco, informe banco, agência, conta, titular, documento e chave PIX.';
    END IF;
  END IF;

  INSERT INTO public.company_payout_profiles AS t (
    company_id,
    payout_mode,
    bank_code,
    bank_name,
    agency,
    account_number,
    account_digit,
    account_type,
    holder_name,
    holder_document,
    pix_key,
    pix_key_type,
    updated_at,
    updated_by
  ) VALUES (
    p_company_id,
    v_mode,
    NULLIF(trim(COALESCE(p_bank_code, '')), ''),
    NULLIF(trim(COALESCE(p_bank_name, '')), ''),
    NULLIF(trim(COALESCE(p_agency, '')), ''),
    NULLIF(trim(COALESCE(p_account_number, '')), ''),
    NULLIF(trim(COALESCE(p_account_digit, '')), ''),
    NULLIF(trim(COALESCE(p_account_type, '')), ''),
    NULLIF(trim(COALESCE(p_holder_name, '')), ''),
    NULLIF(trim(COALESCE(p_holder_document, '')), ''),
    NULLIF(trim(COALESCE(p_pix_key, '')), ''),
    NULLIF(trim(COALESCE(p_pix_key_type, '')), ''),
    timezone('utc'::text, now()),
    auth.uid()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    payout_mode = EXCLUDED.payout_mode,
    bank_code = EXCLUDED.bank_code,
    bank_name = EXCLUDED.bank_name,
    agency = EXCLUDED.agency,
    account_number = EXCLUDED.account_number,
    account_digit = EXCLUDED.account_digit,
    account_type = EXCLUDED.account_type,
    holder_name = EXCLUDED.holder_name,
    holder_document = EXCLUDED.holder_document,
    pix_key = EXCLUDED.pix_key,
    pix_key_type = EXCLUDED.pix_key_type,
    updated_at = timezone('utc'::text, now()),
    updated_by = auth.uid();

  RETURN public.get_company_payout_profile(p_company_id);
END;
$$;

-- =============================================================================
-- 3) Ledger D+1 de ingresso (twin do crédito)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.manager_ticket_settlement_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  receivable_id UUID NOT NULL REFERENCES public.receivables(id) ON DELETE RESTRICT,
  gross_amount NUMERIC(12, 2) NOT NULL CHECK (gross_amount >= 0),
  platform_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  mp_fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (mp_fee_amount >= 0),
  manager_amount NUMERIC(12, 2) NOT NULL CHECK (manager_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'released', 'paid', 'clawback', 'cancelled')),
  release_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payout_batch_id UUID REFERENCES public.credit_payout_batches(id) ON DELETE SET NULL,
  payment_reference TEXT,
  clawback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT manager_ticket_settlement_receivable_unique UNIQUE (receivable_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_ticket_settlement_company_status
  ON public.manager_ticket_settlement_ledger(company_id, status, release_at);

ALTER TABLE public.manager_ticket_settlement_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manager_ticket_settlement_select ON public.manager_ticket_settlement_ledger;
CREATE POLICY manager_ticket_settlement_select ON public.manager_ticket_settlement_ledger
  FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(company_id, auth.uid())
  );

GRANT SELECT ON public.manager_ticket_settlement_ledger TO authenticated;
GRANT ALL ON public.manager_ticket_settlement_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.create_ticket_settlement_from_receivable(
  p_receivable_id UUID,
  p_company_id UUID,
  p_event_id UUID,
  p_gross_amount NUMERIC,
  p_platform_fee NUMERIC,
  p_mp_fee_amount NUMERIC,
  p_manager_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention INTEGER;
  v_id UUID;
  v_manager NUMERIC(12, 2);
BEGIN
  IF p_receivable_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'Receivable/empresa inválidos.';
  END IF;

  v_manager := round(COALESCE(p_manager_amount, 0), 2);
  IF v_manager <= 0 THEN
    RETURN NULL;
  END IF;

  v_retention := public.get_credit_settlement_retention_days();

  INSERT INTO public.manager_ticket_settlement_ledger (
    company_id,
    event_id,
    receivable_id,
    gross_amount,
    platform_fee,
    mp_fee_amount,
    manager_amount,
    status,
    release_at
  ) VALUES (
    p_company_id,
    p_event_id,
    p_receivable_id,
    round(COALESCE(p_gross_amount, 0), 2),
    round(COALESCE(p_platform_fee, 0), 2),
    round(COALESCE(p_mp_fee_amount, 0), 2),
    v_manager,
    'pending',
    timezone('utc'::text, now()) + make_interval(days => v_retention)
  )
  ON CONFLICT (receivable_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.manager_ticket_settlement_ledger
    WHERE receivable_id = p_receivable_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_ticket_settlement_releases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE public.manager_ticket_settlement_ledger
  SET
    status = 'released',
    released_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE status = 'pending'
    AND release_at <= timezone('utc'::text, now());

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- =============================================================================
-- 4) Gate de criação de evento + go-live payout_configured
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_min INTEGER;
  v_is_master BOOLEAN;
  v_blocked BOOLEAN;
  v_count INTEGER;
  v_cb_count INTEGER := 0;
BEGIN
  v_is_master := auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls();

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_is_master THEN
    SELECT COALESCE(c.ticket_inactivity_blocked, false)
    INTO v_blocked
    FROM public.companies c
    WHERE c.id = NEW.company_id;

    IF TG_OP = 'INSERT' AND v_blocked THEN
      PERFORM public.log_admin_master_bypass(
        'ticket_inactivity_create_event',
        'Admin Master criou evento com pendência de inatividade comercial.',
        NEW.company_id,
        NULL,
        jsonb_build_object('event_title', NEW.title)
      );
    END IF;

    SELECT s.open_count INTO v_cb_count
    FROM public.company_open_ticket_chargeback_stats(NEW.company_id) s;

    IF TG_OP = 'INSERT' AND COALESCE(v_cb_count, 0) >= 3 THEN
      PERFORM public.log_admin_master_bypass(
        'ticket_chargeback_create_event',
        'Admin Master criou evento com 3+ chargebacks de ingresso em aberto.',
        NEW.company_id,
        NULL,
        jsonb_build_object('event_title', NEW.title, 'open_chargebacks', v_cb_count)
      );
    END IF;

    IF TG_OP = 'UPDATE'
       AND COALESCE(NEW.is_active, false) = true
       AND COALESCE(OLD.is_active, false) = false
       AND v_blocked THEN
      PERFORM public.log_admin_master_bypass(
        'ticket_inactivity_activate_event',
        'Admin Master reativou evento com pendência de inatividade comercial.',
        NEW.company_id,
        NEW.id,
        jsonb_build_object('event_title', NEW.title)
      );
    END IF;

    IF TG_OP = 'UPDATE'
       AND COALESCE(NEW.is_active, false) = true
       AND COALESCE(OLD.is_active, false) = false
       AND public.company_requires_paid_ticket_event(NEW.company_id)
       AND COALESCE(NEW.is_paid, false) = true THEN
      v_min := public.get_company_min_event_tickets(NEW.company_id);
      v_count := public.event_active_wristband_count(NEW.id);
      IF v_count < v_min THEN
        PERFORM public.log_admin_master_bypass(
          'min_event_tickets_activate',
          format('Admin Master ativou evento com %s ingressos (mínimo %s).', v_count, v_min),
          NEW.company_id,
          NEW.id,
          jsonb_build_object('active_count', v_count, 'min_required', v_min)
        );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.assert_company_not_ticket_inactive(NEW.company_id);
    PERFORM public.assert_company_ticket_chargeback_create_allowed(NEW.company_id);
    PERFORM public.assert_company_payout_setup_for_events(NEW.company_id);
  END IF;

  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_plan_feature(NEW.company_id, 'events_create');
  ELSIF TG_OP = 'INSERT' AND NOT public.company_plan_feature_enabled(NEW.company_id, 'events_create') THEN
    RAISE EXCEPTION
      'O recurso "%" não está disponível no plano comercial desta empresa.',
      public.plan_feature_label('events_create');
  END IF;

  SELECT c.billing_plan INTO v_plan
  FROM public.companies c
  WHERE c.id = NEW.company_id;

  IF v_plan IN (
    'listing_monthly'::public.billing_plan_type,
    'consumption_or_license'::public.billing_plan_type
  ) THEN
    IF COALESCE(NEW.is_paid, false) = true THEN
      RAISE EXCEPTION 'Este plano comercial não permite eventos com venda de ingressos pela plataforma.';
    END IF;
    NEW.listing_only := true;
    NEW.is_paid := false;
  ELSIF v_plan IN (
    'ticket_commission'::public.billing_plan_type,
    'ticket_plus_consumption'::public.billing_plan_type
  ) THEN
    NEW.is_paid := true;
    NEW.listing_only := false;

    IF TG_OP = 'INSERT' THEN
      NEW.is_active := false;
    END IF;

    IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_paid, false) = true AND COALESCE(NEW.is_paid, false) = false THEN
      RAISE EXCEPTION 'Plano com comissão sobre ingressos exige evento pago. Não é permitido alterar para gratuito.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.is_active, false) = true
     AND COALESCE(OLD.is_active, false) = false THEN
    PERFORM public.assert_company_not_ticket_inactive(NEW.company_id);
    PERFORM public.assert_company_ticket_chargeback_create_allowed(NEW.company_id);
    PERFORM public.assert_company_payout_setup_for_events(NEW.company_id);
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.is_active, false) = true
     AND COALESCE(OLD.is_active, false) = false
     AND public.company_requires_paid_ticket_event(NEW.company_id)
     AND COALESCE(NEW.is_paid, false) = true THEN
    v_min := public.get_company_min_event_tickets(NEW.company_id);
    IF public.event_active_wristband_count(NEW.id) < v_min THEN
      RAISE EXCEPTION
        'Para ativar o evento, cadastre pelo menos % ingressos ativos. Mínimo da sua empresa: %.',
        v_min, v_min;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Go-live: mp_configured → payout_configured (preserva checklist completo)
CREATE OR REPLACE FUNCTION public.get_event_go_live_checklist(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_items JSONB := '[]'::jsonb;
  v_auto_required INTEGER := 0;
  v_auto_ready INTEGER := 0;
  v_manual_total INTEGER := 0;
  v_manual_done INTEGER := 0;
  v_batch_total INTEGER := 0;
  v_capacity INTEGER := 0;
  v_batch_rows INTEGER := 0;
  v_integrity JSONB;
  v_payout_ok BOOLEAN := false;
  v_payout_mode TEXT;
  v_ack RECORD;
  v_manual_keys TEXT[] := ARRAY[
    'load_test_approved',
    'runbook_acknowledged',
    'soft_open_planned',
    'support_scheduled'
  ];
  v_key TEXT;
  v_acknowledged BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.user_can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    e.id,
    e.title,
    e.capacity,
    e.inventory_mode,
    e.checkout_queue_enabled,
    e.checkout_async_webhook,
    e.created_by,
    e.company_id,
    e.is_active,
    e.is_paid,
    e.listing_only
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found';
  END IF;

  IF COALESCE(v_event.is_paid, false) IS NOT TRUE
     OR COALESCE(v_event.listing_only, false) IS TRUE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'applies', false,
      'event_id', p_event_id,
      'message', 'Checklist go-live aplica-se a eventos pagos com venda de ingressos.'
    );
  END IF;

  SELECT
    COALESCE(SUM(bi.total), 0)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_batch_total, v_batch_rows
  FROM public.batch_inventory bi
  WHERE bi.event_id = p_event_id;

  v_capacity := COALESCE(v_event.capacity, 0);
  v_integrity := public.verify_event_inventory_integrity(p_event_id);

  v_payout_ok := public.company_has_valid_payout_setup(v_event.company_id);
  SELECT p.payout_mode INTO v_payout_mode
  FROM public.company_payout_profiles p
  WHERE p.company_id = v_event.company_id;

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'counter_mode',
    'label', 'Estoque por lote (contador)',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN v_event.inventory_mode = 'counter' THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN v_event.inventory_mode = 'counter'
      THEN 'Modo contador ativo.'
      ELSE 'Salve os lotes do evento para ativar o estoque por contador.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'inventory_configured',
    'label', 'Lotes e estoque configurados',
    'kind', 'auto',
    'required', true,
    'status', CASE
      WHEN v_batch_rows = 0 OR v_batch_total <= 0 THEN 'fail'
      WHEN v_capacity > 0 AND v_batch_total <> v_capacity THEN 'warning'
      ELSE 'pass'
    END,
    'message', CASE
      WHEN v_batch_rows = 0 THEN 'Nenhum lote com estoque. Salve os lotes no evento.'
      WHEN v_batch_total <= 0 THEN 'Capacidade total dos lotes é zero.'
      WHEN v_capacity > 0 AND v_batch_total <> v_capacity THEN
        format('Soma dos lotes (%s) difere da capacidade (%s) — pode ativar, mas confira.', v_batch_total, v_capacity)
      ELSE format('Estoque total: %s ingressos em %s lote(s).', v_batch_total, v_batch_rows)
    END,
    'details', jsonb_build_object(
      'batch_total', v_batch_total,
      'batch_count', v_batch_rows,
      'event_capacity', v_capacity
    )
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'inventory_integrity',
    'label', 'Integridade de estoque (sem overselling)',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN COALESCE((v_integrity->>'ok')::boolean, false) THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN COALESCE((v_integrity->>'ok')::boolean, false)
      THEN 'Estoque consistente.'
      ELSE 'Inconsistência detectada — contate o suporte antes de abrir vendas.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'queue_enabled',
    'label', 'Fila virtual (picos > 5.000 ingressos)',
    'kind', 'auto',
    'required', false,
    'status', CASE WHEN COALESCE(v_event.checkout_queue_enabled, false) THEN 'pass' ELSE 'warning' END,
    'message', CASE WHEN COALESCE(v_event.checkout_queue_enabled, false)
      THEN 'Fila virtual ativa.'
      ELSE 'Recomendado para eventos com 5.000+ ingressos ou pico alto de acessos.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'async_webhook',
    'label', 'Webhook assíncrono',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN COALESCE(v_event.checkout_async_webhook, false) THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN COALESCE(v_event.checkout_async_webhook, false)
      THEN 'Processamento de pagamento enfileirado.'
      ELSE 'Salve o evento novamente para ativar o webhook assíncrono.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'payout_configured',
    'label', 'Recebimento configurado (MP ou banco/PIX)',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN v_payout_ok THEN 'pass' ELSE 'fail' END,
    'message', CASE
      WHEN v_payout_ok AND v_payout_mode = 'bank_transfer' THEN
        'Conta bancária/PIX OK — vendas liquidam via D+1.'
      WHEN v_payout_ok THEN
        'Mercado Pago OK — split no ato.'
      ELSE
        'Configure Mercado Pago ou conta bancária/PIX em Perfil da Empresa → Recebimento.'
    END,
    'fix_path', '/manager/settings/company-profile?tab=payments'
  ));

  FOREACH v_key IN ARRAY v_manual_keys LOOP
    SELECT a.acknowledged, a.notes
    INTO v_ack
    FROM public.event_go_live_acknowledgements a
    WHERE a.event_id = p_event_id AND a.item_key = v_key;

    v_acknowledged := COALESCE(v_ack.acknowledged, false);

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'key', v_key,
        'label', CASE v_key
          WHEN 'load_test_approved' THEN 'Teste de carga aprovado (k6 / sandbox) — recomendado'
          WHEN 'runbook_acknowledged' THEN 'Runbook operacional lido — recomendado'
          WHEN 'soft_open_planned' THEN 'Soft open planejado — recomendado'
          WHEN 'support_scheduled' THEN 'Suporte reforçado nas 2 h iniciais — recomendado'
        END,
        'kind', 'manual',
        'required', false,
        'status', CASE WHEN v_acknowledged THEN 'pass' ELSE 'pending' END,
        'acknowledged', v_acknowledged,
        'notes', v_ack.notes
      )
    );
  END LOOP;

  SELECT
    COUNT(*) FILTER (
      WHERE (elem->>'kind') = 'auto' AND (elem->>'required')::boolean IS TRUE
    ),
    COUNT(*) FILTER (
      WHERE (elem->>'kind') = 'auto'
        AND (elem->>'required')::boolean IS TRUE
        AND (elem->>'status') = 'pass'
    ),
    COUNT(*) FILTER (WHERE (elem->>'kind') = 'manual'),
    COUNT(*) FILTER (
      WHERE (elem->>'kind') = 'manual' AND (elem->>'status') = 'pass'
    )
  INTO v_auto_required, v_auto_ready, v_manual_total, v_manual_done
  FROM jsonb_array_elements(v_items) AS elem;

  RETURN jsonb_build_object(
    'ok', true,
    'applies', true,
    'event_id', p_event_id,
    'event_title', v_event.title,
    'is_active', v_event.is_active,
    'ready', v_auto_ready >= v_auto_required AND v_auto_required > 0,
    'ready_count', v_auto_ready + v_manual_done,
    'required_count', v_auto_required + v_manual_total,
    'auto_ready', v_auto_ready >= v_auto_required AND v_auto_required > 0,
    'auto_ready_count', v_auto_ready,
    'auto_required_count', v_auto_required,
    'items', v_items,
    'runbook_path', 'docs/RUNBOOK_GRANDE_PORTE.md',
    'load_test_path', 'load-tests/README.md'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.company_manager_has_mp_configured(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_has_valid_payout_setup(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_company_payout_setup_for_events(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_payout_profile(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_company_payout_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ticket_settlement_from_receivable(UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_ticket_settlement_releases() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.company_manager_has_mp_configured(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_has_valid_payout_setup(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_company_payout_setup_for_events(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_company_payout_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_company_payout_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ticket_settlement_from_receivable(UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_ticket_settlement_releases() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_go_live_checklist(UUID) TO authenticated;
