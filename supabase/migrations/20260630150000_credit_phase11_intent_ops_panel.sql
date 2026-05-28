-- Fase 11: estados operacionais da intenção + painel de atendimento (gestor)

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname
  INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'credit_consumption_intents'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.credit_consumption_intents DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.credit_consumption_intents
  ADD CONSTRAINT credit_consumption_intents_status_check
  CHECK (status IN (
    'new',
    'in_preparation',
    'ready_for_pickup',
    'completed',
    'cancelled',
    'expired'
  ));

UPDATE public.credit_consumption_intents
SET status = 'new', updated_at = timezone('utc'::text, now())
WHERE status = 'pending';

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

CREATE OR REPLACE FUNCTION public.mark_client_credit_consumption_intent_biometric(p_intent_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  UPDATE public.credit_consumption_intents i
  SET
    biometric_confirmed_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE i.id = p_intent_id
    AND i.client_user_id = v_user_id
    AND i.status IN ('new', 'in_preparation', 'ready_for_pickup');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intenção não encontrada para confirmação biométrica.';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manager_credit_consumption_intents(
  p_company_id UUID,
  p_status TEXT DEFAULT NULL,
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
  v_status TEXT := NULLIF(trim(COALESCE(p_status, '')), '');
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      i.id,
      i.client_user_id,
      i.establishment_id,
      ce.name AS establishment_name,
      i.status,
      i.gross_amount,
      i.biometric_required,
      (i.biometric_confirmed_at IS NOT NULL) AS biometric_confirmed,
      i.spend_order_id,
      i.created_at,
      i.updated_at,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(ii)::jsonb ORDER BY ii.product_name ASC), '[]'::jsonb)
        FROM (
          SELECT
            x.product_id,
            x.product_name,
            x.quantity,
            x.unit_price,
            x.line_total
          FROM public.credit_consumption_intent_items x
          WHERE x.intent_id = i.id
        ) ii
      ) AS items
    FROM public.credit_consumption_intents i
    JOIN public.credit_establishments ce ON ce.id = i.establishment_id
    WHERE i.company_id = p_company_id
      AND (v_status IS NULL OR i.status = v_status)
    ORDER BY i.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'items', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_manager_credit_consumption_intent_status(
  p_company_id UUID,
  p_intent_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next TEXT := trim(COALESCE(p_status, ''));
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

  UPDATE public.credit_consumption_intents i
  SET
    status = v_next,
    updated_at = timezone('utc'::text, now())
  WHERE i.id = p_intent_id
    AND i.company_id = p_company_id
    AND i.status IN ('new', 'in_preparation', 'ready_for_pickup');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intenção não encontrada ou já finalizada.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_next);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_client_credit_consumption_intent_biometric(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manager_credit_consumption_intents(UUID, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_manager_credit_consumption_intent_status(UUID, UUID, TEXT) TO authenticated;
