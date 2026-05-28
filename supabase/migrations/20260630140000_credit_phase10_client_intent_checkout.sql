-- Fase 10: intenção de compra do cliente (carrinho persistido) + acoplamento no spend

CREATE TABLE IF NOT EXISTS public.credit_consumption_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES public.credit_establishments(id) ON DELETE CASCADE,
  event_id UUID NULL REFERENCES public.events(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'customer_app',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount > 0),
  biometric_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
  biometric_required BOOLEAN NOT NULL DEFAULT false,
  biometric_confirmed_at TIMESTAMPTZ NULL,
  idempotency_key TEXT NULL UNIQUE,
  spend_order_id UUID NULL REFERENCES public.credit_spend_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_credit_consumption_intents_client
  ON public.credit_consumption_intents (client_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_consumption_intents_status
  ON public.credit_consumption_intents (status, establishment_id);

CREATE TABLE IF NOT EXISTS public.credit_consumption_intent_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES public.credit_consumption_intents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.credit_establishment_products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_credit_consumption_intent_items_intent
  ON public.credit_consumption_intent_items (intent_id);

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
    COALESCE(NULLIF(trim(p_channel), ''), 'customer_app'),
    'pending',
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

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', v_intent_id,
    'gross_amount', v_gross,
    'biometric_threshold', v_threshold,
    'biometric_required', (v_threshold > 0 AND v_gross >= v_threshold)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_credit_consumption_intent(p_intent_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_intent public.credit_consumption_intents%ROWTYPE;
  v_items JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents i
  WHERE i.id = p_intent_id
    AND i.client_user_id = v_user_id;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'Intenção não encontrada.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.product_name ASC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ii.id,
      ii.product_id,
      ii.product_name,
      ii.quantity,
      ii.unit_price,
      ii.line_total
    FROM public.credit_consumption_intent_items ii
    WHERE ii.intent_id = v_intent.id
  ) t;

  RETURN jsonb_build_object(
    'id', v_intent.id,
    'status', v_intent.status,
    'establishment_id', v_intent.establishment_id,
    'company_id', v_intent.company_id,
    'event_id', v_intent.event_id,
    'gross_amount', v_intent.gross_amount,
    'biometric_threshold', v_intent.biometric_threshold,
    'biometric_required', v_intent.biometric_required,
    'spend_order_id', v_intent.spend_order_id,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_credit_consumption_intent(UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_credit_consumption_intent(UUID) TO authenticated;
