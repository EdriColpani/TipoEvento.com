-- Entrega de consumo via app validador (chave x-api-key, sem sessão de gestor).
-- Só service_role (Edge Function); não expor a authenticated.

CREATE OR REPLACE FUNCTION public.preview_consumption_delivery_for_validator(
  p_company_id UUID,
  p_delivery_token TEXT,
  p_event_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT := NULLIF(trim(COALESCE(p_delivery_token, '')), '');
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_items JSONB;
  v_client_label TEXT;
  v_client_public_id TEXT;
  v_establishment_name TEXT;
  v_event_title TEXT;
  v_can_confirm BOOLEAN := false;
  v_block_reason TEXT := NULL;
BEGIN
  IF p_company_id IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'Informe o QR do pedido (EFDEL).';
  END IF;

  IF left(upper(v_token), 6) <> 'EFDEL.' THEN
    RAISE EXCEPTION 'QR de pedido inválido. Use o código EFDEL do cliente.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents i
  WHERE i.delivery_token = v_token
    AND i.company_id = p_company_id
    AND (p_event_id IS NULL OR i.event_id IS NULL OR i.event_id = p_event_id);

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'QR inválido ou pedido não encontrado.';
  END IF;

  SELECT ce.name INTO v_establishment_name
  FROM public.credit_establishments ce
  WHERE ce.id = v_intent.establishment_id;

  IF v_intent.event_id IS NOT NULL THEN
    SELECT e.title INTO v_event_title
    FROM public.events e
    WHERE e.id = v_intent.event_id;
  END IF;

  SELECT
    COALESCE(NULLIF(trim(concat_ws(' ', pf.first_name, pf.last_name)), ''), pf.public_id, v_intent.client_user_id::text),
    pf.public_id
  INTO v_client_label, v_client_public_id
  FROM public.profiles pf
  WHERE pf.id = v_intent.client_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', ii.product_id,
    'product_name', ii.product_name,
    'quantity', ii.quantity,
    'unit_price', ii.unit_price,
    'line_total', ii.line_total,
    'description', p.description,
    'image_url', p.image_url,
    'packaging_type', p.packaging_type,
    'units_per_box', p.units_per_box
  ) ORDER BY ii.product_name ASC), '[]'::jsonb)
  INTO v_items
  FROM public.credit_consumption_intent_items ii
  LEFT JOIN public.credit_establishment_products p ON p.id = ii.product_id
  WHERE ii.intent_id = v_intent.id;

  IF v_intent.status = 'completed' THEN
    v_block_reason := 'Pedido já entregue.';
  ELSIF v_intent.spend_order_id IS NULL OR v_intent.paid_at IS NULL THEN
    v_block_reason := 'Pedido ainda não foi pago.';
  ELSIF v_intent.status NOT IN ('ready_for_pickup', 'in_preparation') THEN
    v_block_reason := 'Status do pedido não permite entrega.';
  ELSIF v_intent.delivery_token_expires_at IS NOT NULL
        AND v_intent.delivery_token_expires_at < timezone('utc'::text, now()) THEN
    v_block_reason := 'QR de entrega expirado. Peça ao cliente abrir o pedido no app novamente.';
  ELSE
    v_can_confirm := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', v_intent.id,
    'status', v_intent.status,
    'gross_amount', v_intent.gross_amount,
    'paid_at', v_intent.paid_at,
    'delivery_token_expires_at', v_intent.delivery_token_expires_at,
    'client_label', v_client_label,
    'client_public_id', v_client_public_id,
    'establishment_name', v_establishment_name,
    'event_title', v_event_title,
    'event_id', v_intent.event_id,
    'items', v_items,
    'can_confirm', v_can_confirm,
    'block_reason', v_block_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_consumption_delivery_for_validator(
  p_company_id UUID,
  p_delivery_token TEXT,
  p_operator_label TEXT DEFAULT NULL,
  p_event_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT := NULLIF(trim(COALESCE(p_delivery_token, '')), '');
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_prev TEXT;
  v_items JSONB;
  v_client_label TEXT;
  v_client_public_id TEXT;
  v_event_title TEXT;
  v_operator TEXT := NULLIF(trim(COALESCE(p_operator_label, '')), '');
BEGIN
  IF p_company_id IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'Leitura do QR do cliente é obrigatória para confirmar a entrega.';
  END IF;

  IF left(upper(v_token), 6) <> 'EFDEL.' THEN
    RAISE EXCEPTION 'QR de pedido inválido. Use o código EFDEL do cliente.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents i
  WHERE i.delivery_token = v_token
    AND i.company_id = p_company_id
    AND (p_event_id IS NULL OR i.event_id IS NULL OR i.event_id = p_event_id)
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'QR inválido ou pedido não encontrado.';
  END IF;

  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'intent_id', v_intent.id,
      'status', 'completed',
      'delivered_at', v_intent.delivered_at,
      'message', 'Pedido já entregue.'
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
    RAISE EXCEPTION 'QR de entrega expirado. Peça ao cliente abrir o pedido no app novamente.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', ii.product_id,
    'product_name', ii.product_name,
    'quantity', ii.quantity,
    'unit_price', ii.unit_price,
    'line_total', ii.line_total
  ) ORDER BY ii.product_name ASC), '[]'::jsonb)
  INTO v_items
  FROM public.credit_consumption_intent_items ii
  WHERE ii.intent_id = v_intent.id;

  SELECT
    COALESCE(NULLIF(trim(concat_ws(' ', pf.first_name, pf.last_name)), ''), pf.public_id, v_intent.client_user_id::text),
    pf.public_id
  INTO v_client_label, v_client_public_id
  FROM public.profiles pf
  WHERE pf.id = v_intent.client_user_id;

  SELECT e.title INTO v_event_title
  FROM public.events e
  WHERE e.id = v_intent.event_id;

  v_prev := v_intent.status;

  UPDATE public.credit_consumption_intents
  SET
    status = 'completed',
    delivery_token = NULL,
    delivery_token_expires_at = NULL,
    delivered_at = timezone('utc'::text, now()),
    delivered_by_user_id = NULL,
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
    NULL,
    'validator_app',
    format(
      'Entrega confirmada via app validador (chave=%s); QR invalidado. Cliente=%s; itens=%s',
      COALESCE(v_operator, 'n/d'),
      COALESCE(v_client_public_id, v_client_label, 'n/d'),
      left(COALESCE(v_items::text, '[]'), 400)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'intent_id', v_intent.id,
    'status', 'completed',
    'client_user_id', v_intent.client_user_id,
    'client_label', v_client_label,
    'client_public_id', v_client_public_id,
    'establishment_id', v_intent.establishment_id,
    'event_id', v_intent.event_id,
    'event_title', v_event_title,
    'gross_amount', v_intent.gross_amount,
    'spend_order_id', v_intent.spend_order_id,
    'items', v_items,
    'delivered_at', timezone('utc'::text, now()),
    'message', 'Entrega confirmada. QR invalidado.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_consumption_delivery_for_validator(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_consumption_delivery_for_validator(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_consumption_delivery_for_validator(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_consumption_delivery_for_validator(UUID, TEXT, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.preview_consumption_delivery_for_validator(UUID, TEXT, UUID) IS
  'Preview EFDEL para Edge validate-consumption-delivery (service_role).';
COMMENT ON FUNCTION public.complete_consumption_delivery_for_validator(UUID, TEXT, TEXT, UUID) IS
  'Finaliza entrega EFDEL via app validador; anula token (service_role).';
