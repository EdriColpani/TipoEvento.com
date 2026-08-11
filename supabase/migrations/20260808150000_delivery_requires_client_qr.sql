-- Entrega só com QR do cliente (EFDEL). Não permite concluir só por intent_id.

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
  v_items JSONB;
  v_client_label TEXT;
  v_client_public_id TEXT;
  v_event_title TEXT;
  v_token TEXT := NULLIF(trim(COALESCE(p_delivery_token, '')), '');
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

  -- Obrigatório ler o QR do cliente (anti-fraude / prova de retirada).
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Leitura do QR do cliente é obrigatória para confirmar a entrega.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents i
  WHERE i.delivery_token = v_token
    AND i.company_id = p_company_id
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'QR inválido ou pedido não encontrado.';
  END IF;

  -- Se o painel passou intent_id, deve bater com o QR lido.
  IF p_intent_id IS NOT NULL AND v_intent.id <> p_intent_id THEN
    RAISE EXCEPTION 'QR não corresponde a este pedido.';
  END IF;

  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'intent_id', v_intent.id,
      'status', 'completed',
      'delivered_at', v_intent.delivered_at
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
    delivered_by_user_id = v_user_id,
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
    format(
      'Entrega confirmada via QR; QR invalidado. Cliente=%s; itens=%s',
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
    'delivered_at', timezone('utc'::text, now())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_credit_consumption_delivery(UUID, TEXT, UUID) TO authenticated;
