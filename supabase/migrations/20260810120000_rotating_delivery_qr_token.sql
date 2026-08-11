-- QR de retirada EFDEL: TTL curto + rotação pelo cliente (anti-print).
-- Após entrega (complete_credit_consumption_delivery) o token já é anulado e não regenera.

CREATE OR REPLACE FUNCTION public.refresh_client_credit_delivery_token(p_intent_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_token TEXT;
  v_expires TIMESTAMPTZ;
  v_ttl_seconds INTEGER := 45;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  IF p_intent_id IS NULL THEN
    RAISE EXCEPTION 'Pedido inválido.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents i
  WHERE i.id = p_intent_id
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado.';
  END IF;

  IF v_intent.client_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Sem permissão para este pedido.';
  END IF;

  IF v_intent.status = 'completed' THEN
    RAISE EXCEPTION 'Pedido já entregue. O QR de retirada foi invalidado e não pode ser gerado novamente.';
  END IF;

  IF v_intent.status = 'cancelled' THEN
    RAISE EXCEPTION 'Pedido cancelado. QR indisponível.';
  END IF;

  IF v_intent.spend_order_id IS NULL OR v_intent.paid_at IS NULL THEN
    RAISE EXCEPTION 'Pedido ainda não foi pago.';
  END IF;

  IF v_intent.status NOT IN ('ready_for_pickup', 'in_preparation') THEN
    RAISE EXCEPTION 'Status do pedido não permite QR de retirada.';
  END IF;

  v_token := 'EFDEL.' || encode(gen_random_bytes(18), 'hex');
  v_expires := timezone('utc'::text, now()) + make_interval(secs => v_ttl_seconds);

  UPDATE public.credit_consumption_intents
  SET
    delivery_token = v_token,
    delivery_token_expires_at = v_expires,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', v_intent.id,
    'status', v_intent.status,
    'delivery_token', v_token,
    'delivery_token_expires_at', v_expires,
    'ttl_seconds', v_ttl_seconds,
    'refresh_in_seconds', 30
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_client_credit_delivery_token(UUID) IS
  'Gera novo QR EFDEL (TTL 45s) para o dono do pedido. Bloqueado após completed/cancelled.';

GRANT EXECUTE ON FUNCTION public.refresh_client_credit_delivery_token(UUID) TO authenticated;

-- Pagamento: token inicial também com TTL curto (cliente deve abrir e rotacionar).
CREATE OR REPLACE FUNCTION public.finalize_client_credit_consumption_payment(
  p_intent_id uuid,
  p_spend_order_id uuid,
  p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_items JSONB;
  v_token TEXT;
  v_prev TEXT;
  v_expires TIMESTAMPTZ;
  v_ttl_seconds INTEGER := 45;
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

  IF v_intent.status NOT IN ('new', 'in_preparation') THEN
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
  v_expires := timezone('utc'::text, now()) + make_interval(secs => v_ttl_seconds);

  UPDATE public.credit_consumption_intents
  SET
    status = 'ready_for_pickup',
    spend_order_id = p_spend_order_id,
    idempotency_key = COALESCE(NULLIF(trim(p_idempotency_key), ''), idempotency_key),
    paid_at = timezone('utc'::text, now()),
    delivery_token = v_token,
    delivery_token_expires_at = v_expires,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_intent.id;

  INSERT INTO public.credit_consumption_intent_status_history (
    intent_id, from_status, to_status, changed_by_user_id, source, notes
  ) VALUES (
    v_intent.id, v_prev, 'ready_for_pickup', v_intent.client_user_id, 'customer_app',
    'Crédito debitado na compra; aguardando retirada (QR rotativo)'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'intent_id', v_intent.id,
    'status', 'ready_for_pickup',
    'delivery_token', v_token,
    'delivery_token_expires_at', v_expires,
    'ttl_seconds', v_ttl_seconds,
    'spend_order_id', p_spend_order_id
  );
END;
$function$;
