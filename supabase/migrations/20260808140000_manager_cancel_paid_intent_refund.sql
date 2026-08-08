-- Cancelamento no PDV: motivo obrigatório; se pago → estorno + devolve estoque + invalida QR.

CREATE OR REPLACE FUNCTION public.apply_credit_product_stock_increment(
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
BEGIN
  IF p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Estabelecimento inválido para devolução de estoque.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Itens inválidos para devolução de estoque.';
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
      RAISE EXCEPTION 'Item inválido na devolução de estoque.';
    END IF;

    UPDATE public.credit_establishment_products p
    SET
      quantity = p.quantity + v_qty,
      updated_at = timezone('utc'::text, now())
    WHERE p.id = v_product_id
      AND p.establishment_id = p_establishment_id
      AND p.active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inválido na devolução de estoque.';
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.update_manager_credit_consumption_intent_status(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.update_manager_credit_consumption_intent_status(
  p_company_id UUID,
  p_intent_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next TEXT := trim(COALESCE(p_status, ''));
  v_notes TEXT := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_prev TEXT;
  v_actor UUID := auth.uid();
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_items JSONB;
  v_refunded BOOLEAN := false;
BEGIN
  IF p_company_id IS NULL OR p_intent_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF v_next NOT IN ('new', 'in_preparation', 'ready_for_pickup', 'cancelled') THEN
    RAISE EXCEPTION 'Status operacional inválido.';
  END IF;

  IF v_next = 'cancelled' AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents i
  WHERE i.id = p_intent_id
    AND i.company_id = p_company_id
    AND i.status IN ('new', 'in_preparation', 'ready_for_pickup')
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'Intenção não encontrada ou já finalizada.';
  END IF;

  v_prev := v_intent.status;

  IF v_next = 'cancelled'
     AND v_intent.spend_order_id IS NOT NULL
     AND v_intent.paid_at IS NOT NULL THEN
    PERFORM public.rollback_credit_spend(
      v_intent.spend_order_id,
      left('Cancelamento PDV: ' || v_notes, 500)
    );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', ii.product_id,
      'quantity', ii.quantity
    )), '[]'::jsonb)
    INTO v_items
    FROM public.credit_consumption_intent_items ii
    WHERE ii.intent_id = v_intent.id;

    IF jsonb_array_length(v_items) > 0 THEN
      PERFORM public.apply_credit_product_stock_increment(v_intent.establishment_id, v_items);
    END IF;

    v_refunded := true;
  END IF;

  UPDATE public.credit_consumption_intents i
  SET
    status = v_next,
    delivery_token = CASE WHEN v_next = 'cancelled' THEN NULL ELSE i.delivery_token END,
    delivery_token_expires_at = CASE
      WHEN v_next = 'cancelled' THEN NULL
      ELSE i.delivery_token_expires_at
    END,
    updated_at = timezone('utc'::text, now())
  WHERE i.id = p_intent_id;

  INSERT INTO public.credit_consumption_intent_status_history (
    intent_id,
    from_status,
    to_status,
    changed_by_user_id,
    source,
    notes
  ) VALUES (
    p_intent_id,
    v_prev,
    v_next,
    v_actor,
    'manager_panel',
    CASE
      WHEN v_next = 'cancelled' AND v_refunded THEN
        left('Cancelamento com estorno: ' || v_notes, 1000)
      WHEN v_next = 'cancelled' THEN
        left('Cancelamento: ' || v_notes, 1000)
      ELSE v_notes
    END
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_next,
    'refunded', v_refunded
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_credit_product_stock_increment(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_manager_credit_consumption_intent_status(UUID, UUID, TEXT, TEXT)
  TO authenticated;
