-- Fase 4: estabelecimentos (CRUD gestor), spend consumo PDV, QR carteira (EFW)

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
      AND c.billing_plan IN (
        'ticket_plus_consumption'::public.billing_plan_type,
        'consumption_or_license'::public.billing_plan_type
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_manages_credit_company(
  p_company_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = p_company_id
        AND uc.user_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.list_company_credit_establishments(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      ce.id,
      ce.company_id,
      ce.event_id,
      ce.name,
      ce.credit_acceptance_enabled,
      ce.active,
      ce.created_at,
      e.title AS event_title
    FROM public.credit_establishments ce
    LEFT JOIN public.events e ON e.id = ce.event_id
    WHERE ce.company_id = p_company_id
  ) t;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'module_enabled', public.credit_module_globally_enabled(),
    'company_allows_credit', public.company_allows_credit_consumption(p_company_id),
    'items', v_rows
  );
END;
$$;

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
AS $$
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
      company_id,
      event_id,
      name,
      credit_acceptance_enabled,
      active
    ) VALUES (
      p_company_id,
      p_event_id,
      v_name,
      COALESCE(p_credit_acceptance_enabled, true),
      COALESCE(p_active, true)
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'establishment_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_credit_establishment_active(
  p_establishment_id UUID,
  p_company_id UUID,
  p_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_establishment_pdv_context(p_establishment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_est public.credit_establishments%ROWTYPE;
BEGIN
  IF p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento inválido.';
  END IF;

  SELECT * INTO v_est
  FROM public.credit_establishments
  WHERE id = p_establishment_id;

  IF v_est.id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento não encontrado.';
  END IF;

  IF NOT public.user_manages_credit_company(v_est.company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  RETURN jsonb_build_object(
    'establishment_id', v_est.id,
    'name', v_est.name,
    'company_id', v_est.company_id,
    'event_id', v_est.event_id,
    'active', v_est.active,
    'credit_acceptance_enabled', v_est.credit_acceptance_enabled,
    'module_enabled', public.credit_module_globally_enabled(),
    'company_allows_credit', public.company_allows_credit_consumption(v_est.company_id),
    'ready',
      public.credit_module_globally_enabled()
      AND public.company_allows_credit_consumption(v_est.company_id)
      AND v_est.active
      AND v_est.credit_acceptance_enabled
  );
END;
$$;

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
    RAISE EXCEPTION 'Plano comercial não habilita consumo por crédito.';
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

  v_commission_pct := public.get_credit_consumption_commission_pct();

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

GRANT EXECUTE ON FUNCTION public.company_allows_credit_consumption(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_company_credit_establishments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_credit_establishment(UUID, TEXT, UUID, UUID, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_credit_establishment_active(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_establishment_pdv_context(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_spend_consumption(UUID, UUID, JSONB, TEXT, UUID, TEXT) TO service_role;
