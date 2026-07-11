-- Compra com crédito: suporte a estoque counter + gravação completa (receivables/auditoria)

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
  v_existing_receivable_id UUID;
  v_spend_id UUID;
  v_receivable_id UUID;
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
  v_checkout_idem TEXT;
  v_channel TEXT;
  v_elem JSONB;
  v_wristband_id UUID;
  v_qty INTEGER;
  v_unit_price NUMERIC(12, 2);
  v_name TEXT;
  v_wb RECORD;
  v_analytics_ids UUID[] := ARRAY[]::UUID[];
  v_reserved UUID[];
  v_i INTEGER;
  v_j INTEGER;
  v_emit_count INTEGER;
  v_manager_user_id UUID;
  v_inventory_mode TEXT;
  v_batch_id UUID;
  v_available INTEGER;
  v_rows INTEGER;
  v_seq INTEGER;
  v_code TEXT;
  v_new_id UUID;
  v_paid_at TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  v_channel := COALESCE(NULLIF(trim(p_channel), ''), 'web');
  IF v_channel NOT IN ('web', 'app') THEN
    v_channel := 'web';
  END IF;

  IF p_event_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um ingresso para compra com crédito.';
  END IF;

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT id INTO v_existing_order_id
    FROM public.credit_spend_orders
    WHERE idempotency_key = trim(p_idempotency_key);

    IF v_existing_order_id IS NOT NULL THEN
      SELECT id INTO v_existing_receivable_id
      FROM public.receivables
      WHERE mp_payment_id = v_existing_order_id::text
         OR payment_gateway_id = ('eventfest_credit:' || v_existing_order_id::text)
      ORDER BY created_at DESC
      LIMIT 1;

      RETURN jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'spend_order_id', v_existing_order_id,
        'receivable_id', v_existing_receivable_id,
        'receiver_company_id', (
          SELECT receiver_company_id FROM public.credit_spend_orders WHERE id = v_existing_order_id
        ),
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
    e.created_by,
    e.inventory_mode,
    c.corporate_name
  INTO v_event
  FROM public.events e
  INNER JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = p_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  v_manager_user_id := v_event.created_by;
  IF v_manager_user_id IS NULL THEN
    SELECT uc.user_id INTO v_manager_user_id
    FROM public.user_companies uc
    WHERE uc.company_id = v_event.company_id
    ORDER BY uc.is_primary DESC NULLS LAST, uc.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_manager_user_id IS NULL THEN
    RAISE EXCEPTION 'Evento sem gestor vinculado para registrar a venda.';
  END IF;

  v_inventory_mode := COALESCE(NULLIF(trim(v_event.inventory_mode), ''), 'unit_rows');
  v_commission_pct := public.get_credit_consumption_commission_pct(v_event.company_id);

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_wristband_id := COALESCE(
      NULLIF(trim(v_elem->>'wristband_id'), '')::uuid,
      NULLIF(trim(v_elem->>'ticketTypeId'), '')::uuid
    );
    v_qty := COALESCE((v_elem->>'quantity')::integer, 0);
    v_unit_price := round(COALESCE((v_elem->>'unit_price')::numeric, (v_elem->>'price')::numeric, 0), 2);
    v_name := COALESCE(NULLIF(trim(v_elem->>'name'), ''), 'Ingresso');

    IF v_wristband_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'Item de compra inválido.';
    END IF;

    SELECT w.id, w.event_id, w.price, w.access_type, w.code, w.status
    INTO v_wb
    FROM public.wristbands w
    WHERE w.id = v_wristband_id
      AND w.status = 'active';

    IF v_wb.id IS NULL OR v_wb.event_id <> p_event_id THEN
      RAISE EXCEPTION 'Ingresso não pertence a este evento.';
    END IF;

    IF round(v_wb.price::numeric, 2) <> v_unit_price THEN
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
    v_channel,
    v_uid,
    'completed',
    NULLIF(trim(p_idempotency_key), ''),
    v_correlation
  )
  RETURNING id INTO v_spend_id;

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_wristband_id := COALESCE(
      NULLIF(trim(v_elem->>'wristband_id'), '')::uuid,
      NULLIF(trim(v_elem->>'ticketTypeId'), '')::uuid
    );
    v_qty := (v_elem->>'quantity')::integer;
    v_unit_price := round(COALESCE((v_elem->>'unit_price')::numeric, (v_elem->>'price')::numeric, 0), 2);
    v_name := COALESCE(NULLIF(trim(v_elem->>'name'), ''), 'Ingresso');

    SELECT w.id, w.event_id, w.price, w.access_type, w.code, w.status
    INTO v_wb
    FROM public.wristbands w
    WHERE w.id = v_wristband_id;

    IF v_inventory_mode = 'counter' THEN
      SELECT eb.id INTO v_batch_id
      FROM public.event_batches eb
      WHERE eb.wristband_id = v_wristband_id
        AND eb.event_id = p_event_id
      ORDER BY eb.created_at DESC NULLS LAST
      LIMIT 1;

      IF v_batch_id IS NULL THEN
        RAISE EXCEPTION 'Lote de estoque não encontrado para "%".', v_name;
      END IF;

      PERFORM 1 FROM public.batch_inventory bi WHERE bi.batch_id = v_batch_id FOR UPDATE;

      v_available := public.batch_inventory_available(v_batch_id);
      IF v_available < v_qty THEN
        RAISE EXCEPTION 'Ingressos esgotados para "%". Tente novamente.', v_name;
      END IF;

      UPDATE public.batch_inventory bi
      SET
        sold = bi.sold + v_qty,
        updated_at = timezone('utc'::text, now())
      WHERE bi.batch_id = v_batch_id
        AND (bi.total - bi.sold - bi.reserved) >= v_qty;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'Ingressos esgotados para "%". Tente novamente.', v_name;
      END IF;

      SELECT COALESCE(MAX(wa.sequential_number), 0)
      INTO v_seq
      FROM public.wristband_analytics wa
      WHERE wa.wristband_id = v_wristband_id;

      FOR v_j IN 1 .. v_qty LOOP
        v_seq := v_seq + 1;
        v_code := COALESCE(v_wb.code, 'T') || '-' || lpad(v_seq::text, 6, '0');

        INSERT INTO public.wristband_analytics (
          wristband_id,
          event_type,
          client_user_id,
          code_wristbands,
          status,
          sequential_number,
          event_data
        ) VALUES (
          v_wristband_id,
          'purchase',
          v_uid,
          v_code,
          'active',
          v_seq,
          jsonb_build_object(
            'code', v_code,
            'access_type', v_wb.access_type,
            'unit_price', v_unit_price,
            'price', v_unit_price,
            'event_id', p_event_id,
            'batch_id', v_batch_id,
            'payment_method', 'eventfest_credit',
            'credit_spend_order_id', v_spend_id,
            'purchase_date', v_paid_at,
            'client_id', v_uid,
            'channel', v_channel
          )
        )
        RETURNING id INTO v_new_id;

        v_analytics_ids := v_analytics_ids || v_new_id;
      END LOOP;
    ELSE
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
    END IF;

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

  IF v_inventory_mode <> 'counter' THEN
    UPDATE public.wristband_analytics wa
    SET
      client_user_id = v_uid,
      status = 'active',
      event_type = 'purchase',
      event_data = COALESCE(wa.event_data, '{}'::jsonb) || jsonb_build_object(
        'purchase_date', v_paid_at,
        'client_id', v_uid,
        'payment_method', 'eventfest_credit',
        'credit_spend_order_id', v_spend_id,
        'access_type', COALESCE(wa.event_data->>'access_type', (
          SELECT w.access_type FROM public.wristbands w WHERE w.id = wa.wristband_id
        )),
        'unit_price', COALESCE((wa.event_data->>'unit_price')::numeric, (
          SELECT round(w.price::numeric, 2) FROM public.wristbands w WHERE w.id = wa.wristband_id
        )),
        'channel', v_channel
      )
    WHERE wa.id = ANY (v_analytics_ids)
      AND wa.client_user_id IS NULL
      AND wa.status = 'active';

    GET DIAGNOSTICS v_emit_count = ROW_COUNT;
    IF v_emit_count <> COALESCE(array_length(v_analytics_ids, 1), 0) THEN
      RAISE EXCEPTION 'Não foi possível emitir os ingressos. Tente novamente.';
    END IF;
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

  v_checkout_idem := CASE
    WHEN NULLIF(trim(p_idempotency_key), '') IS NOT NULL
      THEN 'credit:' || trim(p_idempotency_key)
    ELSE 'credit:spend:' || v_spend_id::text
  END;

  INSERT INTO public.receivables (
    client_user_id,
    manager_user_id,
    event_id,
    total_value,
    total_amount,
    status,
    payment_status,
    payment_gateway_id,
    mp_payment_id,
    mp_status_detail,
    gross_amount,
    mp_fee_amount,
    platform_fee_amount,
    net_amount_after_mp,
    paid_at,
    wristband_analytics_ids,
    checkout_idempotency_key
  ) VALUES (
    v_uid,
    v_manager_user_id,
    p_event_id,
    v_gross,
    v_gross,
    'paid',
    'approved',
    'eventfest_credit:' || v_spend_id::text,
    v_spend_id::text,
    'eventfest_credit',
    v_gross,
    0,
    v_platform,
    v_manager,
    v_paid_at,
    v_analytics_ids,
    v_checkout_idem
  )
  RETURNING id INTO v_receivable_id;

  UPDATE public.wristband_analytics wa
  SET event_data = COALESCE(wa.event_data, '{}'::jsonb) || jsonb_build_object(
    'transaction_id', v_receivable_id,
    'total_paid', v_gross,
    'credit_spend_order_id', v_spend_id,
    'payment_method', 'eventfest_credit'
  )
  WHERE wa.id = ANY (v_analytics_ids);

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
      'Spend ticket | gross R$ %s | platform R$ %s | manager R$ %s | pct %s%% | receivable %s | channel %s',
      v_gross, v_platform, v_manager, v_commission_pct, v_receivable_id, v_channel
    ),
    jsonb_build_object(
      'wristband_analytics_ids', to_jsonb(v_analytics_ids),
      'items_summary', v_items_summary,
      'consumption_commission_pct', v_commission_pct,
      'receivable_id', v_receivable_id,
      'channel', v_channel,
      'inventory_mode', v_inventory_mode,
      'items', p_items
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

  INSERT INTO public.credit_audit_log (
    event_type,
    actor_user_id,
    subject_user_id,
    company_id,
    reference_type,
    reference_id,
    summary,
    payload
  ) VALUES (
    'ticket_credit_purchase',
    v_uid,
    v_uid,
    v_event.company_id,
    'credit_spend_order',
    v_spend_id,
    v_desc,
    jsonb_build_object(
      'receivable_id', v_receivable_id,
      'ledger_id', v_ledger_id,
      'gross_amount', v_gross,
      'platform_amount', v_platform,
      'manager_amount', v_manager,
      'commission_pct', v_commission_pct,
      'channel', v_channel,
      'event_id', p_event_id,
      'event_title', v_event.title,
      'wristband_analytics_ids', to_jsonb(v_analytics_ids),
      'items_summary', v_items_summary,
      'inventory_mode', v_inventory_mode
    )
  );

  BEGIN
    PERFORM public.invalidate_event_availability_cache(p_event_id);
  EXCEPTION
    WHEN undefined_function THEN
      NULL;
    WHEN OTHERS THEN
      NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'spend_order_id', v_spend_id,
    'receivable_id', v_receivable_id,
    'ledger_id', v_ledger_id,
    'balance', v_new_balance,
    'gross_amount', v_gross,
    'platform_amount', v_platform,
    'manager_amount', v_manager,
    'receiver_company_id', v_event.company_id,
    'wristband_analytics_ids', to_jsonb(v_analytics_ids),
    'public_description', v_desc,
    'channel', v_channel
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.credit_spend_ticket_purchase(UUID, JSONB, TEXT, TEXT) IS
  'Compra de ingresso com crédito: counter/unit_rows, receivable pago, ledger, split e auditoria.';

GRANT EXECUTE ON FUNCTION public.credit_spend_ticket_purchase(UUID, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_spend_ticket_purchase(UUID, JSONB, TEXT, TEXT) TO service_role;
