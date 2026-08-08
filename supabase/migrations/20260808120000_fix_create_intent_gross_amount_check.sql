-- Fix: create_credit_consumption_intent não pode INSERT com gross_amount=0
-- (CHECK credit_consumption_intents_gross_amount_check exige > 0).

CREATE OR REPLACE FUNCTION public.create_credit_consumption_intent(
  p_establishment_id UUID,
  p_items JSONB,
  p_channel TEXT DEFAULT 'customer_app',
  p_event_id UUID DEFAULT NULL
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
  v_event_id UUID;
  v_lines JSONB := '[]'::jsonb;
  v_line JSONB;
  v_biometric_required BOOLEAN;
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

  v_event_id := COALESCE(p_event_id, v_est.event_id);

  IF p_event_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = p_event_id
        AND e.company_id = v_est.company_id
        AND COALESCE(e.is_active, true) = true
        AND COALESCE(e.credit_consumption_enabled, false) = true
    ) THEN
      RAISE EXCEPTION 'Evento inválido para este estabelecimento.';
    END IF;

    IF v_est.event_id IS NOT NULL AND v_est.event_id <> p_event_id THEN
      RAISE EXCEPTION 'Estabelecimento vinculado a outro evento.';
    END IF;
  END IF;

  v_threshold := public.get_credit_spend_biometric_threshold();

  -- 1ª passagem: valida estoque/preço e monta o total (evita INSERT com gross=0).
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

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'product_name', v_product.name,
        'quantity', v_qty,
        'unit_price', v_product.unit_price,
        'line_total', v_line_total
      )
    );
  END LOOP;

  IF v_gross <= 0 THEN
    RAISE EXCEPTION 'Valor total inválido.';
  END IF;

  v_biometric_required := (v_threshold > 0 AND v_gross >= v_threshold);

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
    v_event_id,
    v_source,
    'new',
    v_gross,
    v_threshold,
    v_biometric_required
  )
  RETURNING id INTO v_intent_id;

  FOR v_i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->v_i;
    INSERT INTO public.credit_consumption_intent_items (
      intent_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total
    ) VALUES (
      v_intent_id,
      (v_line->>'product_id')::uuid,
      v_line->>'product_name',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::numeric,
      (v_line->>'line_total')::numeric
    );
  END LOOP;

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
    'biometric_required', v_biometric_required,
    'event_id', v_event_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_credit_consumption_intent(UUID, JSONB, TEXT, UUID) TO authenticated;
