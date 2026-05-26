-- Fase 3: pagar ingressos com crédito EventFest (débito carteira + splits + emissão pulseiras)

CREATE OR REPLACE FUNCTION public.format_credit_spend_public_description(
  p_company_name TEXT,
  p_event_title TEXT,
  p_items_summary TEXT,
  p_gross_amount NUMERIC,
  p_balance_after NUMERIC
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT format(
    E'**Uso de crédito** — %s — Evento "%s" — %s — R$ %s.\nSaldo após operação: R$ %s.',
    COALESCE(NULLIF(trim(p_company_name), ''), 'Parceiro EventFest'),
    COALESCE(NULLIF(trim(p_event_title), ''), 'Evento'),
    COALESCE(NULLIF(trim(p_items_summary), ''), 'Ingressos'),
    to_char(round(COALESCE(p_gross_amount, 0)::numeric, 2), 'FM999999990.00'),
    to_char(round(COALESCE(p_balance_after, 0)::numeric, 2), 'FM999999990.00')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_event_credit_payment_eligibility(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module BOOLEAN;
  v_event RECORD;
  v_has_credit_col BOOLEAN;
  v_credit_enabled BOOLEAN := false;
  v_plan_ok BOOLEAN := false;
  v_sales_open BOOLEAN := false;
  v_tickets_allowed BOOLEAN := false;
BEGIN
  v_module := public.credit_module_globally_enabled();

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Evento inválido.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'events'
  ) THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'module_enabled', v_module,
      'reason', 'Eventos indisponíveis neste ambiente.'
    );
  END IF;

  SELECT
    e.id,
    e.title,
    e.is_active,
    e.listing_only,
    e.company_id,
    c.corporate_name,
    c.billing_plan
  INTO v_event
  FROM public.events e
  LEFT JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = p_event_id;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Evento não encontrado.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'credit_consumption_enabled'
  ) INTO v_has_credit_col;

  IF v_has_credit_col THEN
    EXECUTE $sql$
      SELECT COALESCE(credit_consumption_enabled, false)
      FROM public.events
      WHERE id = $1
    $sql$
    INTO v_credit_enabled
    USING p_event_id;
  END IF;

  v_plan_ok := v_event.billing_plan IN (
    'ticket_plus_consumption'::public.billing_plan_type,
    'consumption_or_license'::public.billing_plan_type
  );

  v_sales_open := public.event_accepts_new_sales(p_event_id);
  v_tickets_allowed := public.event_allows_ticket_sales(p_event_id);

  RETURN jsonb_build_object(
    'eligible',
      v_module
      AND COALESCE(v_event.is_active, true)
      AND COALESCE(v_event.listing_only, false) = false
      AND v_credit_enabled
      AND v_plan_ok
      AND v_sales_open
      AND v_tickets_allowed,
    'module_enabled', v_module,
    'event_credit_enabled', v_credit_enabled,
    'company_plan_ok', v_plan_ok,
    'sales_open', v_sales_open,
    'tickets_allowed', v_tickets_allowed,
    'event_active', COALESCE(v_event.is_active, true),
    'listing_only', COALESCE(v_event.listing_only, false),
    'company_name', v_event.corporate_name,
    'event_title', v_event.title,
    'reason', CASE
      WHEN NOT v_module THEN 'O módulo de créditos EventFest não está disponível.'
      WHEN COALESCE(v_event.is_active, true) = false THEN 'Evento inativo para novas compras.'
      WHEN COALESCE(v_event.listing_only, false) THEN 'Evento em modo divulgação.'
      WHEN NOT v_credit_enabled THEN 'Este evento não aceita pagamento com crédito EventFest.'
      WHEN NOT v_plan_ok THEN 'Plano comercial da empresa não habilita créditos.'
      WHEN NOT v_sales_open THEN 'Prazo de vendas encerrado.'
      WHEN NOT v_tickets_allowed THEN 'Venda de ingressos indisponível para este evento.'
      ELSE NULL
    END
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

  v_commission_pct := public.get_credit_consumption_commission_pct();

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

CREATE OR REPLACE FUNCTION public.list_manager_credit_spends(
  p_company_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
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

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      o.id AS spend_order_id,
      o.gross_amount,
      o.receiver_event_id AS event_id,
      e.title AS event_title,
      o.public_description,
      o.created_at,
      s.platform_amount,
      s.manager_amount,
      s.applied_percentage
    FROM public.credit_spend_orders o
    LEFT JOIN public.events e ON e.id = o.receiver_event_id
    LEFT JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
    WHERE o.receiver_company_id = p_company_id
      AND o.status = 'completed'
    ORDER BY o.created_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 200))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_credit_payment_eligibility(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.credit_spend_ticket_purchase(UUID, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manager_credit_spends(UUID, INTEGER, INTEGER) TO authenticated;
