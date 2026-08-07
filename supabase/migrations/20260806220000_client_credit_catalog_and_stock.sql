-- Catálogo cliente (evento / estabelecimento) + baixa estoque + token de entrega do pedido.

SELECT public.security_open_change_window('client credit catalog checkout delivery token', 20);

ALTER TABLE public.credit_consumption_intents
  ADD COLUMN IF NOT EXISTS delivery_token TEXT,
  ADD COLUMN IF NOT EXISTS delivery_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_consumption_intents_delivery_token
  ON public.credit_consumption_intents (delivery_token)
  WHERE delivery_token IS NOT NULL;

COMMENT ON COLUMN public.credit_consumption_intents.delivery_token IS
  'Token opaco do QR de entrega do pedido (após pagamento).';
COMMENT ON COLUMN public.credit_consumption_intents.paid_at IS
  'Momento em que o crédito foi debitado (compra confirmada).';

-- Estoque disponível em “unidades de venda” (caixa = nº de caixas; unit = unidades).
CREATE OR REPLACE FUNCTION public.credit_product_sale_stock_available(
  p_product public.credit_establishment_products
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, COALESCE(p_product.quantity, 0));
$$;

CREATE OR REPLACE FUNCTION public.apply_credit_product_stock_decrement(
  p_establishment_id UUID,
  p_items JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_product_id UUID;
  v_qty INTEGER;
  v_i INTEGER;
  v_available INTEGER;
  v_name TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Itens inválidos para baixa de estoque.';
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_product_id := NULLIF(trim(COALESCE(
      v_elem->>'product_id',
      v_elem->>'productId',
      ''
    )), '')::uuid;
    v_qty := COALESCE((v_elem->>'quantity')::integer, 0);

    IF v_product_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item inválido na baixa de estoque.';
    END IF;

    UPDATE public.credit_establishment_products p
    SET
      quantity = p.quantity - v_qty,
      updated_at = timezone('utc'::text, now())
    WHERE p.id = v_product_id
      AND p.establishment_id = p_establishment_id
      AND p.active = true
      AND p.quantity >= v_qty
    RETURNING p.name, p.quantity + v_qty INTO v_name, v_available;

    IF v_name IS NULL THEN
      SELECT name, quantity INTO v_name, v_available
      FROM public.credit_establishment_products
      WHERE id = v_product_id AND establishment_id = p_establishment_id;

      RAISE EXCEPTION
        'Estoque insuficiente para "%": disponível %, solicitado %.',
        COALESCE(v_name, 'produto'),
        COALESCE(v_available, 0),
        v_qty;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_client_event_credit_catalog(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_establishments JSONB;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Evento inválido.';
  END IF;

  IF NOT public.credit_module_globally_enabled() THEN
    RETURN jsonb_build_object(
      'ok', true,
      'event', NULL,
      'establishments', '[]'::jsonb,
      'message', 'Módulo de créditos EventFest indisponível.'
    );
  END IF;

  SELECT
    e.id,
    e.title,
    e.date,
    e.location,
    e.company_id,
    c.corporate_name AS company_name,
    COALESCE(e.credit_consumption_enabled, false) AS credit_consumption_enabled
  INTO v_event
  FROM public.events e
  JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = p_event_id
    AND COALESCE(e.is_active, true) = true;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  IF NOT v_event.credit_consumption_enabled
     OR NOT public.company_allows_credit_consumption(v_event.company_id) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'event', jsonb_build_object(
        'id', v_event.id,
        'title', v_event.title,
        'date', v_event.date,
        'location', v_event.location,
        'company_id', v_event.company_id,
        'company_name', v_event.company_name
      ),
      'establishments', '[]'::jsonb,
      'message', 'Este evento não está habilitado para consumo com crédito.'
    );
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
  INTO v_establishments
  FROM (
    SELECT
      ce.id AS establishment_id,
      ce.name,
      ce.address,
      ce.event_id,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb ORDER BY p.name ASC), '[]'::jsonb)
        FROM (
          SELECT
            pr.id,
            pr.name,
            pr.description,
            pr.unit_price,
            pr.image_url,
            pr.packaging_type,
            pr.units_per_box,
            pr.quantity AS stock_quantity,
            CASE
              WHEN pr.packaging_type = 'box'
                THEN COALESCE(pr.units_per_box, 0) * COALESCE(pr.quantity, 0)
              ELSE COALESCE(pr.quantity, 0)
            END AS total_units
          FROM public.credit_establishment_products pr
          WHERE pr.establishment_id = ce.id
            AND pr.active = true
            AND pr.quantity > 0
        ) p
      ) AS products
    FROM public.credit_establishments ce
    WHERE ce.company_id = v_event.company_id
      AND ce.active = true
      AND ce.credit_acceptance_enabled = true
      AND (ce.event_id = p_event_id OR ce.event_id IS NULL)
  ) t
  WHERE jsonb_array_length(t.products) > 0;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'id', v_event.id,
      'title', v_event.title,
      'date', v_event.date,
      'location', v_event.location,
      'company_id', v_event.company_id,
      'company_name', v_event.company_name
    ),
    'establishments', COALESCE(v_establishments, '[]'::jsonb),
    'message', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_client_establishment_credit_catalog(
  p_establishment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_est RECORD;
  v_products JSONB;
BEGIN
  IF p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento inválido.';
  END IF;

  IF NOT public.credit_module_globally_enabled() THEN
    RETURN jsonb_build_object(
      'ok', true,
      'establishment', NULL,
      'products', '[]'::jsonb,
      'message', 'Módulo de créditos EventFest indisponível.'
    );
  END IF;

  SELECT
    ce.id,
    ce.name,
    ce.address,
    ce.event_id,
    ce.company_id,
    c.corporate_name AS company_name,
    e.title AS event_title
  INTO v_est
  FROM public.credit_establishments ce
  JOIN public.companies c ON c.id = ce.company_id
  LEFT JOIN public.events e ON e.id = ce.event_id
  WHERE ce.id = p_establishment_id
    AND ce.active = true
    AND ce.credit_acceptance_enabled = true;

  IF v_est.id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento não encontrado ou indisponível.';
  END IF;

  IF NOT public.company_allows_credit_consumption(v_est.company_id) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'establishment', jsonb_build_object(
        'id', v_est.id,
        'name', v_est.name,
        'company_id', v_est.company_id,
        'company_name', v_est.company_name,
        'event_id', v_est.event_id,
        'event_title', v_est.event_title
      ),
      'products', '[]'::jsonb,
      'message', 'Plano da empresa não habilita consumo com crédito.'
    );
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb ORDER BY p.name ASC), '[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      pr.id,
      pr.name,
      pr.description,
      pr.unit_price,
      pr.image_url,
      pr.packaging_type,
      pr.units_per_box,
      pr.quantity AS stock_quantity,
      CASE
        WHEN pr.packaging_type = 'box'
          THEN COALESCE(pr.units_per_box, 0) * COALESCE(pr.quantity, 0)
        ELSE COALESCE(pr.quantity, 0)
      END AS total_units
    FROM public.credit_establishment_products pr
    WHERE pr.establishment_id = v_est.id
      AND pr.active = true
      AND pr.quantity > 0
  ) p;

  RETURN jsonb_build_object(
    'ok', true,
    'establishment', jsonb_build_object(
      'id', v_est.id,
      'name', v_est.name,
      'address', v_est.address,
      'company_id', v_est.company_id,
      'company_name', v_est.company_name,
      'event_id', v_est.event_id,
      'event_title', v_est.event_title
    ),
    'products', COALESCE(v_products, '[]'::jsonb),
    'message', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.client_event_has_credit_catalog(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  v_payload := public.list_client_event_credit_catalog(p_event_id);
  RETURN jsonb_array_length(COALESCE(v_payload->'establishments', '[]'::jsonb)) > 0;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

-- Valida estoque na criação do intent (antes do débito).
CREATE OR REPLACE FUNCTION public.create_credit_consumption_intent(
  p_establishment_id UUID,
  p_items JSONB,
  p_channel TEXT DEFAULT 'customer_app'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_est public.credit_establishments%ROWTYPE;
  v_threshold NUMERIC(12,2);
  v_gross NUMERIC(12,2) := 0;
  v_intent_id UUID;
  v_elem JSONB;
  v_qty INTEGER;
  v_product_id UUID;
  v_product public.credit_establishment_products%ROWTYPE;
  v_line_total NUMERIC(12,2);
  v_i INTEGER;
  v_source TEXT := COALESCE(NULLIF(trim(p_channel), ''), 'customer_app');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  IF p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento inválido.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.';
  END IF;

  SELECT * INTO v_est
  FROM public.credit_establishments ce
  WHERE ce.id = p_establishment_id;

  IF v_est.id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento não encontrado.';
  END IF;

  IF NOT public.credit_module_globally_enabled() THEN
    RAISE EXCEPTION 'Módulo de créditos EventFest indisponível.';
  END IF;

  IF NOT public.company_allows_credit_consumption(v_est.company_id) THEN
    RAISE EXCEPTION 'Plano comercial não habilita consumo por crédito.';
  END IF;

  IF NOT v_est.active OR NOT v_est.credit_acceptance_enabled THEN
    RAISE EXCEPTION 'Este balcão não está habilitado para consumo com crédito.';
  END IF;

  v_threshold := public.get_credit_spend_biometric_threshold();

  INSERT INTO public.credit_consumption_intents (
    client_user_id,
    company_id,
    establishment_id,
    event_id,
    channel,
    status,
    gross_amount,
    biometric_threshold,
    biometric_required
  ) VALUES (
    v_user_id,
    v_est.company_id,
    v_est.id,
    v_est.event_id,
    v_source,
    'new',
    0,
    v_threshold,
    false
  )
  RETURNING id INTO v_intent_id;

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_product_id := NULLIF(trim(COALESCE(v_elem->>'productId', '')), '')::uuid;
    v_qty := COALESCE((v_elem->>'quantity')::integer, 0);

    IF v_product_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item inválido no carrinho.';
    END IF;

    SELECT * INTO v_product
    FROM public.credit_establishment_products p
    WHERE p.id = v_product_id
      AND p.establishment_id = v_est.id
      AND p.company_id = v_est.company_id
      AND p.active = true;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produto inválido para este estabelecimento.';
    END IF;

    IF COALESCE(v_product.quantity, 0) < v_qty THEN
      RAISE EXCEPTION
        'Estoque insuficiente para "%": disponível %, solicitado %.',
        v_product.name,
        COALESCE(v_product.quantity, 0),
        v_qty;
    END IF;

    v_line_total := round(v_product.unit_price * v_qty, 2);
    v_gross := round(v_gross + v_line_total, 2);

    INSERT INTO public.credit_consumption_intent_items (
      intent_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total
    ) VALUES (
      v_intent_id,
      v_product.id,
      v_product.name,
      v_qty,
      v_product.unit_price,
      v_line_total
    );
  END LOOP;

  IF v_gross <= 0 THEN
    RAISE EXCEPTION 'Valor total inválido.';
  END IF;

  UPDATE public.credit_consumption_intents i
  SET
    gross_amount = v_gross,
    biometric_required = (v_threshold > 0 AND v_gross >= v_threshold),
    updated_at = timezone('utc'::text, now())
  WHERE i.id = v_intent_id;

  INSERT INTO public.credit_consumption_intent_status_history (
    intent_id,
    from_status,
    to_status,
    changed_by_user_id,
    source,
    notes
  ) VALUES (
    v_intent_id,
    NULL,
    'new',
    v_user_id,
    v_source,
    'Intent criada pelo cliente'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', v_intent_id,
    'gross_amount', v_gross,
    'biometric_threshold', v_threshold,
    'biometric_required', (v_threshold > 0 AND v_gross >= v_threshold)
  );
END;
$$;

-- Após débito: marca pago, gera token de entrega e baixa estoque.
CREATE OR REPLACE FUNCTION public.finalize_client_credit_consumption_payment(
  p_intent_id UUID,
  p_spend_order_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_items JSONB;
  v_token TEXT;
  v_prev TEXT;
BEGIN
  IF p_intent_id IS NULL OR p_spend_order_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'Intenção não encontrada.';
  END IF;

  IF v_intent.spend_order_id IS NOT NULL
     AND v_intent.status IN ('ready_for_pickup', 'completed') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'intent_id', v_intent.id,
      'status', v_intent.status,
      'delivery_token', v_intent.delivery_token,
      'delivery_token_expires_at', v_intent.delivery_token_expires_at,
      'spend_order_id', v_intent.spend_order_id
    );
  END IF;

  IF v_intent.status NOT IN ('new', 'pending', 'in_preparation') THEN
    RAISE EXCEPTION 'Esta intenção não pode mais ser cobrada.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', ii.product_id,
    'quantity', ii.quantity
  )), '[]'::jsonb)
  INTO v_items
  FROM public.credit_consumption_intent_items ii
  WHERE ii.intent_id = v_intent.id;

  PERFORM public.apply_credit_product_stock_decrement(v_intent.establishment_id, v_items);

  v_token := 'EFDEL.' || encode(gen_random_bytes(18), 'hex');
  v_prev := v_intent.status;

  UPDATE public.credit_consumption_intents
  SET
    status = 'ready_for_pickup',
    spend_order_id = p_spend_order_id,
    idempotency_key = COALESCE(NULLIF(trim(p_idempotency_key), ''), idempotency_key),
    paid_at = timezone('utc'::text, now()),
    delivery_token = v_token,
    delivery_token_expires_at = timezone('utc'::text, now()) + interval '48 hours',
    updated_at = timezone('utc'::text, now())
  WHERE id = v_intent.id;

  INSERT INTO public.credit_consumption_intent_status_history (
    intent_id,
    from_status,
    to_status,
    changed_by_user_id,
    source,
    notes
  ) VALUES (
    v_intent.id,
    v_prev,
    'ready_for_pickup',
    v_intent.client_user_id,
    'customer_app',
    'Crédito debitado na compra; aguardando retirada'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'intent_id', v_intent.id,
    'status', 'ready_for_pickup',
    'delivery_token', v_token,
    'delivery_token_expires_at', timezone('utc'::text, now()) + interval '48 hours',
    'spend_order_id', p_spend_order_id
  );
END;
$$;

-- Entrega: invalida QR e conclui pedido (já pago).
CREATE OR REPLACE FUNCTION public.complete_credit_consumption_delivery(
  p_company_id UUID,
  p_delivery_token TEXT DEFAULT NULL,
  p_intent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_prev TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id, v_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para este estabelecimento.';
  END IF;

  IF NULLIF(trim(COALESCE(p_delivery_token, '')), '') IS NOT NULL THEN
    SELECT * INTO v_intent
    FROM public.credit_consumption_intents i
    WHERE i.delivery_token = trim(p_delivery_token)
      AND i.company_id = p_company_id
    FOR UPDATE;
  ELSIF p_intent_id IS NOT NULL THEN
    SELECT * INTO v_intent
    FROM public.credit_consumption_intents i
    WHERE i.id = p_intent_id
      AND i.company_id = p_company_id
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Informe o QR do pedido ou o ID da intenção.';
  END IF;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado.';
  END IF;

  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'intent_id', v_intent.id,
      'status', 'completed'
    );
  END IF;

  IF v_intent.spend_order_id IS NULL OR v_intent.paid_at IS NULL THEN
    RAISE EXCEPTION 'Pedido ainda não foi pago.';
  END IF;

  IF v_intent.status NOT IN ('ready_for_pickup', 'in_preparation') THEN
    RAISE EXCEPTION 'Status do pedido não permite entrega.';
  END IF;

  IF v_intent.delivery_token_expires_at IS NOT NULL
     AND v_intent.delivery_token_expires_at < timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'QR de entrega expirado.';
  END IF;

  v_prev := v_intent.status;

  UPDATE public.credit_consumption_intents
  SET
    status = 'completed',
    delivery_token = NULL,
    delivery_token_expires_at = NULL,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_intent.id;

  INSERT INTO public.credit_consumption_intent_status_history (
    intent_id,
    from_status,
    to_status,
    changed_by_user_id,
    source,
    notes
  ) VALUES (
    v_intent.id,
    v_prev,
    'completed',
    v_user_id,
    'manager_panel',
    'Entrega confirmada; QR invalidado'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'intent_id', v_intent.id,
    'status', 'completed',
    'client_user_id', v_intent.client_user_id,
    'establishment_id', v_intent.establishment_id,
    'event_id', v_intent.event_id,
    'gross_amount', v_intent.gross_amount,
    'spend_order_id', v_intent.spend_order_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_client_event_credit_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_establishment_credit_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_event_has_credit_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_product_stock_decrement(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_client_credit_consumption_payment(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_credit_consumption_delivery(UUID, TEXT, UUID) TO authenticated;
