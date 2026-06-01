-- Licença consumo/licença (Opção A), % consumo separados híbrido vs consumo/licença, bloqueio até pagar

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS hybrid_consumption_commission_pct NUMERIC(5, 2) NOT NULL DEFAULT 8.00,
  ADD COLUMN IF NOT EXISTS consumption_license_commission_pct NUMERIC(5, 2) NOT NULL DEFAULT 8.00,
  ADD COLUMN IF NOT EXISTS consumption_license_default_fee NUMERIC(10, 2) NOT NULL DEFAULT 99.99;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_billing_settings_hybrid_commission_pct_check'
  ) THEN
    ALTER TABLE public.system_billing_settings
      ADD CONSTRAINT system_billing_settings_hybrid_commission_pct_check
      CHECK (hybrid_consumption_commission_pct >= 0 AND hybrid_consumption_commission_pct <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_billing_settings_consumption_license_commission_pct_check'
  ) THEN
    ALTER TABLE public.system_billing_settings
      ADD CONSTRAINT system_billing_settings_consumption_license_commission_pct_check
      CHECK (consumption_license_commission_pct >= 0 AND consumption_license_commission_pct <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_billing_settings_consumption_license_fee_check'
  ) THEN
    ALTER TABLE public.system_billing_settings
      ADD CONSTRAINT system_billing_settings_consumption_license_fee_check
      CHECK (consumption_license_default_fee >= 0);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.system_billing_settings.hybrid_consumption_commission_pct IS
  '% EventFest sobre consumo de crédito — plano ticket_plus_consumption (híbrido).';
COMMENT ON COLUMN public.system_billing_settings.consumption_license_commission_pct IS
  '% EventFest sobre consumo de crédito — plano consumption_or_license.';
COMMENT ON COLUMN public.system_billing_settings.consumption_license_default_fee IS
  'Licença mensal padrão do plano consumo/licença (R$). Opção A: só consumption_or_license.';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS consumption_license_fee NUMERIC(10, 2);

COMMENT ON COLUMN public.companies.consumption_license_fee IS
  'Override da licença mensal consumo/licença. NULL = padrão do sistema.';

CREATE TABLE IF NOT EXISTS public.company_consumption_license_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  notes TEXT,
  paid_at TIMESTAMPTZ,
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  checkout_initiated_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (company_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_consumption_license_charges_company_month
  ON public.company_consumption_license_charges(company_id, reference_month DESC);

CREATE INDEX IF NOT EXISTS idx_consumption_license_charges_status
  ON public.company_consumption_license_charges(status);

ALTER TABLE public.company_consumption_license_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consumption_license_charges_select" ON public.company_consumption_license_charges;
CREATE POLICY "consumption_license_charges_select"
  ON public.company_consumption_license_charges
  FOR SELECT
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_consumption_license_charges.company_id
        AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "consumption_license_charges_admin_all" ON public.company_consumption_license_charges;
CREATE POLICY "consumption_license_charges_admin_all"
  ON public.company_consumption_license_charges
  FOR ALL
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

-- ---------------------------------------------------------------------------
-- Comissão por plano da empresa recebedora
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_credit_consumption_commission_pct();

CREATE OR REPLACE FUNCTION public.get_credit_consumption_commission_pct(p_receiver_company_id UUID DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_settings RECORD;
BEGIN
  SELECT
    s.credit_consumption_commission_pct,
    s.hybrid_consumption_commission_pct,
    s.consumption_license_commission_pct
  INTO v_settings
  FROM public.system_billing_settings s
  WHERE s.id = 1;

  IF p_receiver_company_id IS NULL THEN
    RETURN COALESCE(v_settings.credit_consumption_commission_pct, 8.00::NUMERIC);
  END IF;

  SELECT c.billing_plan INTO v_plan
  FROM public.companies c
  WHERE c.id = p_receiver_company_id;

  IF v_plan = 'ticket_plus_consumption'::public.billing_plan_type THEN
    RETURN COALESCE(v_settings.hybrid_consumption_commission_pct, v_settings.credit_consumption_commission_pct, 8.00::NUMERIC);
  END IF;

  IF v_plan = 'consumption_or_license'::public.billing_plan_type THEN
    RETURN COALESCE(v_settings.consumption_license_commission_pct, v_settings.credit_consumption_commission_pct, 8.00::NUMERIC);
  END IF;

  RETURN COALESCE(v_settings.credit_consumption_commission_pct, 8.00::NUMERIC);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_credit_consumption_commission_pct(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_consumption_license_default_fee()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.consumption_license_default_fee FROM public.system_billing_settings s WHERE s.id = 1),
    99.99::NUMERIC
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_consumption_license_default_fee() TO authenticated;

CREATE OR REPLACE FUNCTION public.company_requires_consumption_license(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT c.billing_plan = 'consumption_or_license'::public.billing_plan_type
      FROM public.companies c
      WHERE c.id = p_company_id
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.company_requires_consumption_license(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.company_consumption_license_is_paid(
  p_company_id UUID,
  p_reference_month DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_requires BOOLEAN;
BEGIN
  v_requires := public.company_requires_consumption_license(p_company_id);
  IF NOT v_requires THEN
    RETURN true;
  END IF;

  v_month := date_trunc('month', COALESCE(p_reference_month, CURRENT_DATE))::date;

  RETURN EXISTS (
    SELECT 1
    FROM public.company_consumption_license_charges ch
    WHERE ch.company_id = p_company_id
      AND ch.reference_month = v_month
      AND ch.status = 'paid'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_consumption_license_is_paid(UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.company_allows_credit_consumption(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = p_company_id
      AND (
        c.billing_plan IN (
          'ticket_plus_consumption'::public.billing_plan_type,
          'consumption_or_license'::public.billing_plan_type
        )
        OR (
          c.billing_plan = 'ticket_commission'::public.billing_plan_type
          AND public.credit_module_globally_enabled()
        )
      )
      AND public.company_consumption_license_is_paid(p_company_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_consumption_license_charge(
  p_company_id UUID,
  p_reference_month DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_amount NUMERIC(10, 2);
  v_month DATE;
  v_charge RECORD;
  v_system_default NUMERIC(10, 2);
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.user_can_manage_company_billing(p_company_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão para esta empresa.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF v_company.billing_plan IS DISTINCT FROM 'consumption_or_license'::public.billing_plan_type THEN
    RAISE EXCEPTION 'Empresa não está no plano consumo/licença.';
  END IF;

  v_month := date_trunc('month', COALESCE(p_reference_month, CURRENT_DATE))::date;
  v_system_default := public.get_consumption_license_default_fee();
  v_amount := COALESCE(v_company.consumption_license_fee, v_system_default, 0);

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;

  INSERT INTO public.company_consumption_license_charges (
    company_id, reference_month, amount, status, created_by
  ) VALUES (
    p_company_id, v_month, v_amount, 'pending', auth.uid()
  )
  ON CONFLICT (company_id, reference_month)
  DO UPDATE SET
    amount = EXCLUDED.amount,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_charge;

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge.id,
    'reference_month', v_charge.reference_month,
    'amount', v_charge.amount,
    'status', v_charge.status,
    'already_paid', v_charge.status = 'paid',
    'requires_payment', v_charge.status <> 'paid'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_consumption_license_charge_mp_preference(
  p_charge_id UUID,
  p_preference_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_consumption_license_charges
  SET
    mp_preference_id = p_preference_id,
    checkout_initiated_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
    AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_consumption_license_charge_payment(
  p_charge_id UUID,
  p_mp_payment_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge RECORD;
BEGIN
  UPDATE public.company_consumption_license_charges
  SET
    status = 'paid',
    paid_at = timezone('utc'::text, now()),
    mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
    AND status = 'pending'
  RETURNING * INTO v_charge;

  IF v_charge.id IS NULL THEN
    SELECT * INTO v_charge
    FROM public.company_consumption_license_charges
    WHERE id = p_charge_id;

    IF v_charge.id IS NULL THEN
      RAISE EXCEPTION 'Cobrança não encontrada.';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', v_charge.status, 'idempotent', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'paid', 'charge_id', v_charge.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_consumption_license_status(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_requires BOOLEAN;
  v_charge RECORD;
BEGIN
  v_requires := public.company_requires_consumption_license(p_company_id);
  v_month := date_trunc('month', CURRENT_DATE)::date;

  IF NOT v_requires THEN
    RETURN jsonb_build_object(
      'requires_license', false,
      'is_paid', true,
      'blocks_consumption', false
    );
  END IF;

  SELECT * INTO v_charge
  FROM public.company_consumption_license_charges ch
  WHERE ch.company_id = p_company_id
    AND ch.reference_month = v_month
  ORDER BY ch.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'requires_license', true,
    'reference_month', v_month,
    'charge_id', v_charge.id,
    'amount', v_charge.amount,
    'status', COALESCE(v_charge.status, 'missing'),
    'is_paid', COALESCE(v_charge.status = 'paid', false),
    'blocks_consumption', NOT public.company_consumption_license_is_paid(p_company_id, v_month)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_consumption_license_charge(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_consumption_license_charge_mp_preference(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_consumption_license_charge_payment(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_consumption_license_status(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_consumption_license_charge(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_consumption_license_charge_mp_preference(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_consumption_license_charge_payment(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_consumption_license_status(UUID) TO authenticated;

-- Spend PDV: comissão pelo plano da empresa recebedora
CREATE OR REPLACE FUNCTION public.credit_spend_consumption(
  p_establishment_id UUID,
  p_client_user_id UUID,
  p_items JSONB,
  p_idempotency_key TEXT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT auth.uid(),
  p_channel TEXT DEFAULT 'pos'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_est public.credit_establishments%ROWTYPE;
  v_company_name TEXT;
  v_event_title TEXT;
  v_existing_order_id UUID;
  v_spend_id UUID;
  v_correlation UUID := gen_random_uuid();
  v_commission_pct NUMERIC(5, 2);
  v_gross NUMERIC(12, 2) := 0;
  v_platform NUMERIC(12, 2);
  v_manager NUMERIC(12, 2);
  v_account public.client_credit_accounts%ROWTYPE;
  v_new_balance NUMERIC(12, 2);
  v_desc TEXT;
  v_items_summary TEXT := '';
  v_ledger_id UUID;
  v_idem TEXT;
  v_elem JSONB;
  v_qty INTEGER;
  v_unit_price NUMERIC(12, 2);
  v_name TEXT;
  v_i INTEGER;
BEGIN
  IF p_establishment_id IS NULL OR p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um produto.';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Operador inválido.';
  END IF;

  SELECT * INTO v_est
  FROM public.credit_establishments
  WHERE id = p_establishment_id;

  IF v_est.id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento não encontrado.';
  END IF;

  IF NOT public.user_manages_credit_company(v_est.company_id, p_actor_user_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão para operar neste PDV.';
  END IF;

  IF NOT public.credit_module_globally_enabled() THEN
    RAISE EXCEPTION 'Módulo de créditos EventFest indisponível.';
  END IF;

  IF NOT public.company_allows_credit_consumption(v_est.company_id) THEN
    RAISE EXCEPTION 'Plano comercial não habilita consumo por crédito ou licença mensal pendente.';
  END IF;

  IF NOT v_est.active OR NOT v_est.credit_acceptance_enabled THEN
    RAISE EXCEPTION 'Este ponto de venda não aceita crédito EventFest.';
  END IF;

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing_order_id
    FROM public.credit_spend_orders
    WHERE idempotency_key = trim(p_idempotency_key);

    IF v_existing_order_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'spend_order_id', v_existing_order_id,
        'balance', (SELECT balance_cached FROM public.client_credit_accounts WHERE user_id = p_client_user_id)
      );
    END IF;
  END IF;

  SELECT c.corporate_name INTO v_company_name
  FROM public.companies c
  WHERE c.id = v_est.company_id;

  IF v_est.event_id IS NOT NULL THEN
    SELECT e.title INTO v_event_title
    FROM public.events e
    WHERE e.id = v_est.event_id;
  END IF;

  v_commission_pct := public.get_credit_consumption_commission_pct(v_est.company_id);

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_qty := COALESCE((v_elem->>'quantity')::integer, 0);
    v_unit_price := round(COALESCE((v_elem->>'unit_price')::numeric, 0), 2);
    v_name := COALESCE(NULLIF(trim(v_elem->>'product_name'), ''), 'Produto');

    IF v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'Item inválido: %.', v_name;
    END IF;

    v_gross := round(v_gross + (v_unit_price * v_qty), 2);

    IF v_items_summary <> '' THEN
      v_items_summary := v_items_summary || ', ';
    END IF;
    v_items_summary := v_items_summary || format('%sx %s', v_qty, v_name);
  END LOOP;

  IF v_gross <= 0 THEN
    RAISE EXCEPTION 'Valor total inválido.';
  END IF;

  PERFORM public.ensure_client_credit_account(p_client_user_id);

  SELECT * INTO v_account
  FROM public.client_credit_accounts
  WHERE user_id = p_client_user_id
  FOR UPDATE;

  IF v_account.status <> 'active' THEN
    RAISE EXCEPTION 'Carteira do cliente não está ativa.';
  END IF;

  IF round(v_account.balance_cached, 2) < v_gross THEN
    RAISE EXCEPTION 'Saldo insuficiente. Cliente tem R$ %s e o total é R$ %s.',
      to_char(v_account.balance_cached, 'FM999999990.00'),
      to_char(v_gross, 'FM999999990.00');
  END IF;

  v_platform := round(v_gross * (v_commission_pct / 100.0), 2);
  v_manager := round(v_gross - v_platform, 2);
  v_new_balance := round(v_account.balance_cached - v_gross, 2);

  INSERT INTO public.credit_spend_orders (
    client_user_id,
    receiver_company_id,
    receiver_event_id,
    receiver_establishment_id,
    gross_amount,
    channel,
    actor_user_id,
    status,
    idempotency_key,
    correlation_id
  ) VALUES (
    p_client_user_id,
    v_est.company_id,
    v_est.event_id,
    p_establishment_id,
    v_gross,
    COALESCE(NULLIF(trim(p_channel), ''), 'pos'),
    p_actor_user_id,
    'completed',
    NULLIF(trim(p_idempotency_key), ''),
    v_correlation
  )
  RETURNING id INTO v_spend_id;

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_qty := (v_elem->>'quantity')::integer;
    v_unit_price := round((v_elem->>'unit_price')::numeric, 2);
    v_name := COALESCE(NULLIF(trim(v_elem->>'product_name'), ''), 'Produto');

    INSERT INTO public.credit_spend_line_items (
      spend_order_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total,
      item_type
    ) VALUES (
      v_spend_id,
      NULLIF(trim(v_elem->>'product_id'), '')::uuid,
      v_name,
      v_qty,
      v_unit_price,
      round(v_unit_price * v_qty, 2),
      'consumption'
    );
  END LOOP;

  v_desc := public.format_credit_spend_public_description(
    v_company_name,
    COALESCE(v_event_title, v_est.name),
    v_items_summary,
    v_gross,
    v_new_balance
  );

  UPDATE public.credit_spend_orders
  SET public_description = v_desc
  WHERE id = v_spend_id;

  v_idem := COALESCE(
    NULLIF(trim(p_idempotency_key), ''),
    'spend:consumption:' || v_spend_id::text
  );

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    correlation_id,
    receiver_company_id,
    receiver_event_id,
    receiver_establishment_id,
    reference_type,
    reference_id,
    public_description,
    internal_description,
    metadata
  ) VALUES (
    p_client_user_id,
    'spend',
    'spend_debit',
    -v_gross,
    v_new_balance,
    v_idem,
    v_correlation,
    v_est.company_id,
    v_est.event_id,
    p_establishment_id,
    'credit_spend_order',
    v_spend_id,
    v_desc,
    format(
      'Spend PDV | gross R$ %s | platform R$ %s | manager R$ %s | pct %s%% | actor %s',
      v_gross, v_platform, v_manager, v_commission_pct, p_actor_user_id
    ),
    jsonb_build_object(
      'items_summary', v_items_summary,
      'consumption_commission_pct', v_commission_pct,
      'establishment_id', p_establishment_id,
      'channel', p_channel
    )
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.client_credit_accounts
  SET
    balance_cached = v_new_balance,
    version = version + 1,
    updated_at = timezone('utc'::text, now())
  WHERE user_id = p_client_user_id;

  UPDATE public.platform_credit_liability
  SET
    outstanding_amount = greatest(0, outstanding_amount - v_gross),
    updated_at = timezone('utc'::text, now())
  WHERE id = 1;

  INSERT INTO public.credit_financial_splits (
    spend_order_id,
    receiver_company_id,
    gross_amount,
    platform_amount,
    manager_amount,
    applied_percentage
  ) VALUES (
    v_spend_id,
    v_est.company_id,
    v_gross,
    v_platform,
    v_manager,
    v_commission_pct
  );

  RETURN jsonb_build_object(
    'ok', true,
    'spend_order_id', v_spend_id,
    'ledger_id', v_ledger_id,
    'balance', v_new_balance,
    'gross_amount', v_gross,
    'platform_amount', v_platform,
    'manager_amount', v_manager,
    'public_description', v_desc
  );
END;
$$;

-- Upgrade / confirmação de plano: licença integral ao entrar em consumption_or_license
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
  v_license JSONB;
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano desta empresa.';
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
  ELSIF NOT public.billing_plan_selectable_by_gestor(p_new_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível.';
  END IF;

  PERFORM public.assert_billing_plan_contract_match(p_new_plan, p_contract_id);

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

  v_license := NULL;
  IF p_new_plan = 'consumption_or_license'::public.billing_plan_type THEN
    v_license := public.ensure_consumption_license_charge(p_company_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'billing_plan', p_new_plan,
    'consumption_license', v_license
  );
END;
$$;

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
  v_license JSONB;
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano desta empresa.';
  END IF;

  IF public.user_is_admin_master_for_rls() THEN
  ELSIF NOT public.billing_plan_selectable_by_gestor(p_plan) THEN
    RAISE EXCEPTION 'Este plano ainda não está disponível.';
  END IF;

  PERFORM public.assert_billing_plan_contract_match(p_plan, p_contract_id);

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT id, contract_type INTO v_contract FROM public.event_contracts WHERE id = p_contract_id;

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

  v_license := NULL;
  IF p_plan = 'consumption_or_license'::public.billing_plan_type THEN
    v_license := public.ensure_consumption_license_charge(p_company_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'billing_plan', p_plan,
    'change_type', v_change_type,
    'consumption_license', v_license
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.credit_spend_ticket_purchase(
  p_event_id UUID,
  p_items JSONB,
  p_idempotency_key TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT 'web'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_event RECORD;
  v_eligibility JSONB;
  v_account public.client_credit_accounts%ROWTYPE;
  v_existing_order_id UUID;
  v_spend_id UUID;
  v_correlation UUID := gen_random_uuid();
  v_commission_pct NUMERIC(5, 2);
  v_gross NUMERIC(12, 2) := 0;
  v_platform NUMERIC(12, 2);
  v_manager NUMERIC(12, 2);
  v_new_balance NUMERIC(12, 2);
  v_desc TEXT;
  v_items_summary TEXT := '';
  v_ledger_id UUID;
  v_idem TEXT;
  v_elem JSONB;
  v_wristband_id UUID;
  v_qty INTEGER;
  v_unit_price NUMERIC(12, 2);
  v_name TEXT;
  v_wb_price NUMERIC(12, 2);
  v_wb_event_id UUID;
  v_analytics_ids UUID[] := ARRAY[]::UUID[];
  v_reserved UUID[];
  v_i INTEGER;
  v_emit_count INTEGER;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF p_event_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um ingresso para compra com crédito.';
  END IF;

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing_order_id
    FROM public.credit_spend_orders
    WHERE idempotency_key = trim(p_idempotency_key);

    IF v_existing_order_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'spend_order_id', v_existing_order_id,
        'balance', (SELECT balance_cached FROM public.client_credit_accounts WHERE user_id = v_uid)
      );
    END IF;
  END IF;

  v_eligibility := public.get_event_credit_payment_eligibility(p_event_id);
  IF NOT COALESCE((v_eligibility->>'eligible')::boolean, false) THEN
    RAISE EXCEPTION '%', COALESCE(v_eligibility->>'reason', 'Pagamento com crédito indisponível para este evento.');
  END IF;

  SELECT
    e.id,
    e.title,
    e.company_id,
    c.corporate_name
  INTO v_event
  FROM public.events e
  INNER JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = p_event_id;

  v_commission_pct := public.get_credit_consumption_commission_pct(v_event.company_id);

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_wristband_id := NULLIF(trim(v_elem->>'wristband_id'), '')::uuid;
    v_qty := COALESCE((v_elem->>'quantity')::integer, 0);
    v_unit_price := round(COALESCE((v_elem->>'unit_price')::numeric, 0), 2);
    v_name := COALESCE(NULLIF(trim(v_elem->>'name'), ''), 'Ingresso');

    IF v_wristband_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'Item de compra inválido.';
    END IF;

    SELECT round(w.price::numeric, 2), w.event_id
    INTO v_wb_price, v_wb_event_id
    FROM public.wristbands w
    WHERE w.id = v_wristband_id
      AND w.status = 'active';

    IF v_wb_event_id IS NULL OR v_wb_event_id <> p_event_id THEN
      RAISE EXCEPTION 'Ingresso não pertence a este evento.';
    END IF;

    IF v_wb_price <> v_unit_price THEN
      RAISE EXCEPTION 'Preço do ingresso "%" desatualizado. Atualize a página e tente novamente.', v_name;
    END IF;

    v_gross := round(v_gross + (v_unit_price * v_qty), 2);

    IF v_items_summary <> '' THEN
      v_items_summary := v_items_summary || ', ';
    END IF;
    v_items_summary := v_items_summary || format('%sx %s', v_qty, v_name);
  END LOOP;

  IF v_gross <= 0 THEN
    RAISE EXCEPTION 'Valor total inválido.';
  END IF;

  PERFORM public.ensure_client_credit_account(v_uid);

  SELECT * INTO v_account
  FROM public.client_credit_accounts
  WHERE user_id = v_uid
  FOR UPDATE;

  IF v_account.status <> 'active' THEN
    RAISE EXCEPTION 'Sua carteira EventFest não está ativa.';
  END IF;

  IF round(v_account.balance_cached, 2) < v_gross THEN
    RAISE EXCEPTION 'Saldo insuficiente. Você tem R$ %s e o total é R$ %s.',
      to_char(v_account.balance_cached, 'FM999999990.00'),
      to_char(v_gross, 'FM999999990.00');
  END IF;

  v_platform := round(v_gross * (v_commission_pct / 100.0), 2);
  v_manager := round(v_gross - v_platform, 2);
  v_new_balance := round(v_account.balance_cached - v_gross, 2);

  INSERT INTO public.credit_spend_orders (
    client_user_id,
    receiver_company_id,
    receiver_event_id,
    gross_amount,
    channel,
    actor_user_id,
    status,
    idempotency_key,
    correlation_id
  ) VALUES (
    v_uid,
    v_event.company_id,
    p_event_id,
    v_gross,
    COALESCE(NULLIF(trim(p_channel), ''), 'web'),
    v_uid,
    'completed',
    NULLIF(trim(p_idempotency_key), ''),
    v_correlation
  )
  RETURNING id INTO v_spend_id;

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_wristband_id := NULLIF(trim(v_elem->>'wristband_id'), '')::uuid;
    v_qty := (v_elem->>'quantity')::integer;
    v_unit_price := round((v_elem->>'unit_price')::numeric, 2);
    v_name := COALESCE(NULLIF(trim(v_elem->>'name'), ''), 'Ingresso');

    SELECT array_agg(sub.id ORDER BY sub.id)
    INTO v_reserved
    FROM (
      SELECT wa.id
      FROM public.wristband_analytics wa
      WHERE wa.wristband_id = v_wristband_id
        AND wa.status = 'active'
        AND wa.client_user_id IS NULL
      ORDER BY wa.id
      LIMIT v_qty
      FOR UPDATE SKIP LOCKED
    ) sub;

    IF COALESCE(array_length(v_reserved, 1), 0) < v_qty THEN
      RAISE EXCEPTION 'Ingressos esgotados para "%". Tente novamente.', v_name;
    END IF;

    v_analytics_ids := v_analytics_ids || v_reserved;

    INSERT INTO public.credit_spend_line_items (
      spend_order_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total,
      item_type
    ) VALUES (
      v_spend_id,
      v_wristband_id,
      v_name,
      v_qty,
      v_unit_price,
      round(v_unit_price * v_qty, 2),
      'ticket'
    );
  END LOOP;

  UPDATE public.wristband_analytics wa
  SET
    client_user_id = v_uid,
    status = 'active',
    event_type = 'purchase',
    event_data = COALESCE(wa.event_data, '{}'::jsonb) || jsonb_build_object(
      'purchase_date', to_jsonb(timezone('utc'::text, now()))::text,
      'client_id', v_uid,
      'payment_method', 'eventfest_credit',
      'credit_spend_order_id', v_spend_id
    )
  WHERE wa.id = ANY (v_analytics_ids)
    AND wa.client_user_id IS NULL
    AND wa.status = 'active';

  GET DIAGNOSTICS v_emit_count = ROW_COUNT;
  IF v_emit_count <> COALESCE(array_length(v_analytics_ids, 1), 0) THEN
    RAISE EXCEPTION 'Não foi possível emitir os ingressos. Tente novamente.';
  END IF;

  v_desc := public.format_credit_spend_public_description(
    v_event.corporate_name,
    v_event.title,
    v_items_summary,
    v_gross,
    v_new_balance
  );

  UPDATE public.credit_spend_orders
  SET public_description = v_desc
  WHERE id = v_spend_id;

  v_idem := COALESCE(
    NULLIF(trim(p_idempotency_key), ''),
    'spend:ticket:' || v_spend_id::text
  );

  INSERT INTO public.credit_ledger_entries (
    account_user_id,
    entry_type,
    entry_subtype,
    amount,
    balance_after,
    idempotency_key,
    correlation_id,
    receiver_company_id,
    receiver_event_id,
    reference_type,
    reference_id,
    public_description,
    internal_description,
    metadata
  ) VALUES (
    v_uid,
    'spend',
    'spend_debit',
    -v_gross,
    v_new_balance,
    v_idem,
    v_correlation,
    v_event.company_id,
    p_event_id,
    'credit_spend_order',
    v_spend_id,
    v_desc,
    format(
      'Spend ticket | gross R$ %s | platform R$ %s | manager R$ %s | pct %s%%',
      v_gross, v_platform, v_manager, v_commission_pct
    ),
    jsonb_build_object(
      'wristband_analytics_ids', to_jsonb(v_analytics_ids),
      'items_summary', v_items_summary,
      'consumption_commission_pct', v_commission_pct
    )
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.client_credit_accounts
  SET
    balance_cached = v_new_balance,
    version = version + 1,
    updated_at = timezone('utc'::text, now())
  WHERE user_id = v_uid;

  UPDATE public.platform_credit_liability
  SET
    outstanding_amount = greatest(0, outstanding_amount - v_gross),
    updated_at = timezone('utc'::text, now())
  WHERE id = 1;

  INSERT INTO public.credit_financial_splits (
    spend_order_id,
    receiver_company_id,
    gross_amount,
    platform_amount,
    manager_amount,
    applied_percentage
  ) VALUES (
    v_spend_id,
    v_event.company_id,
    v_gross,
    v_platform,
    v_manager,
    v_commission_pct
  );

  RETURN jsonb_build_object(
    'ok', true,
    'spend_order_id', v_spend_id,
    'ledger_id', v_ledger_id,
    'balance', v_new_balance,
    'gross_amount', v_gross,
    'platform_amount', v_platform,
    'manager_amount', v_manager,
    'wristband_analytics_ids', to_jsonb(v_analytics_ids),
    'public_description', v_desc
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;
