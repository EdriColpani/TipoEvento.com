-- Desconto % no app/cardápio do cliente (PDV permanece no preço cheio).

SELECT public.security_open_change_window('credit product app discount', 20);

ALTER TABLE public.credit_establishment_products
  ADD COLUMN IF NOT EXISTS app_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_establishment_products_app_discount_pct_check'
  ) THEN
    ALTER TABLE public.credit_establishment_products
      ADD CONSTRAINT credit_establishment_products_app_discount_pct_check
      CHECK (app_discount_pct >= 0 AND app_discount_pct <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.credit_establishment_products.app_discount_pct IS
  'Percentual de desconto no app/cardápio do cliente (0–100). PDV usa o preço cheio.';

CREATE OR REPLACE FUNCTION public.credit_product_app_unit_price(
  p_unit_price NUMERIC,
  p_app_discount_pct NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    COALESCE(p_unit_price, 0)
      * (1 - GREATEST(0, LEAST(100, COALESCE(p_app_discount_pct, 0))) / 100.0),
    2
  );
$$;

CREATE OR REPLACE FUNCTION public.list_credit_establishment_products(
  p_company_id UUID,
  p_establishment_id UUID
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
  IF p_company_id IS NULL OR p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.credit_establishments ce
    WHERE ce.id = p_establishment_id
      AND ce.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Estabelecimento inválido para esta empresa.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id,
      p.establishment_id,
      p.company_id,
      p.name,
      p.description,
      p.unit_price,
      p.app_discount_pct,
      public.credit_product_app_unit_price(p.unit_price, p.app_discount_pct) AS app_unit_price,
      p.active,
      p.image_url,
      p.packaging_type,
      p.units_per_box,
      p.quantity,
      CASE
        WHEN p.packaging_type = 'box' THEN COALESCE(p.units_per_box, 0) * COALESCE(p.quantity, 0)
        ELSE COALESCE(p.quantity, 0)
      END AS total_units,
      p.created_at,
      p.updated_at
    FROM public.credit_establishment_products p
    WHERE p.company_id = p_company_id
      AND p.establishment_id = p_establishment_id
  ) t;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'establishment_id', p_establishment_id,
    'module_enabled', public.credit_module_globally_enabled(),
    'company_allows_credit', public.company_allows_credit_consumption(p_company_id),
    'items', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_credit_establishment_product(
  p_company_id UUID,
  p_establishment_id UUID,
  p_name TEXT,
  p_unit_price NUMERIC,
  p_description TEXT DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_active BOOLEAN DEFAULT true,
  p_image_url TEXT DEFAULT NULL,
  p_packaging_type TEXT DEFAULT 'unit',
  p_units_per_box INTEGER DEFAULT NULL,
  p_quantity INTEGER DEFAULT 0,
  p_app_discount_pct NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT;
  v_price NUMERIC(12,2);
  v_packaging TEXT;
  v_units_per_box INTEGER;
  v_quantity INTEGER;
  v_image TEXT;
  v_total INTEGER;
  v_discount NUMERIC(5,2);
BEGIN
  IF p_company_id IS NULL OR p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF NOT public.company_allows_credit_consumption(p_company_id) THEN
    RAISE EXCEPTION 'Plano comercial da empresa não habilita consumo por crédito.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.credit_establishments ce
    WHERE ce.id = p_establishment_id
      AND ce.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Estabelecimento inválido para esta empresa.';
  END IF;

  v_name := trim(COALESCE(p_name, ''));
  v_price := round(COALESCE(p_unit_price, 0)::numeric, 2);
  v_packaging := lower(trim(COALESCE(p_packaging_type, 'unit')));
  v_quantity := COALESCE(p_quantity, 0);
  v_image := NULLIF(trim(COALESCE(p_image_url, '')), '');
  v_discount := round(COALESCE(p_app_discount_pct, 0)::numeric, 2);

  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome do produto.';
  END IF;

  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Preço unitário inválido.';
  END IF;

  IF v_discount < 0 OR v_discount > 100 THEN
    RAISE EXCEPTION 'Informe um desconto entre 0 e 100%%.';
  END IF;

  IF public.credit_product_app_unit_price(v_price, v_discount) <= 0 AND v_discount > 0 THEN
    RAISE EXCEPTION 'Desconto deixaria o preço do app zerado. Use no máximo 99%%.';
  END IF;

  IF v_packaging NOT IN ('unit', 'box') THEN
    RAISE EXCEPTION 'Tipo de embalagem inválido. Use unidade ou caixa.';
  END IF;

  IF v_quantity < 0 THEN
    RAISE EXCEPTION 'Quantidade inválida.';
  END IF;

  IF v_packaging = 'box' THEN
    v_units_per_box := p_units_per_box;
    IF v_units_per_box IS NULL OR v_units_per_box <= 0 THEN
      RAISE EXCEPTION 'Informe a quantidade de unidades por caixa.';
    END IF;
  ELSE
    v_units_per_box := NULL;
  END IF;

  v_total := CASE
    WHEN v_packaging = 'box' THEN v_units_per_box * v_quantity
    ELSE v_quantity
  END;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.credit_establishment_products p
    SET
      name = v_name,
      description = NULLIF(trim(COALESCE(p_description, '')), ''),
      unit_price = v_price,
      app_discount_pct = v_discount,
      active = COALESCE(p_active, true),
      image_url = v_image,
      packaging_type = v_packaging,
      units_per_box = v_units_per_box,
      quantity = v_quantity,
      updated_at = timezone('utc'::text, now())
    WHERE p.id = p_product_id
      AND p.company_id = p_company_id
      AND p.establishment_id = p_establishment_id
    RETURNING p.id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Produto não encontrado.';
    END IF;
  ELSE
    INSERT INTO public.credit_establishment_products (
      establishment_id,
      company_id,
      name,
      description,
      unit_price,
      app_discount_pct,
      active,
      image_url,
      packaging_type,
      units_per_box,
      quantity
    ) VALUES (
      p_establishment_id,
      p_company_id,
      v_name,
      NULLIF(trim(COALESCE(p_description, '')), ''),
      v_price,
      v_discount,
      COALESCE(p_active, true),
      v_image,
      v_packaging,
      v_units_per_box,
      v_quantity
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_id,
    'total_units', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_credit_product_app_discount(
  p_company_id UUID,
  p_establishment_id UUID,
  p_app_discount_pct NUMERIC,
  p_scope TEXT DEFAULT 'establishment'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_discount NUMERIC(5,2);
  v_scope TEXT;
  v_event_id UUID;
  v_updated INTEGER := 0;
BEGIN
  IF p_company_id IS NULL OR p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  v_discount := round(COALESCE(p_app_discount_pct, 0)::numeric, 2);
  v_scope := lower(trim(COALESCE(p_scope, 'establishment')));

  IF v_discount < 0 OR v_discount > 100 THEN
    RAISE EXCEPTION 'Informe um desconto entre 0 e 100%%.';
  END IF;

  IF v_scope NOT IN ('establishment', 'event') THEN
    RAISE EXCEPTION 'Escopo inválido.';
  END IF;

  SELECT ce.event_id INTO v_event_id
  FROM public.credit_establishments ce
  WHERE ce.id = p_establishment_id
    AND ce.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estabelecimento inválido para esta empresa.';
  END IF;

  IF v_scope = 'event' THEN
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'Este estabelecimento não está vinculado a um evento.';
    END IF;

    UPDATE public.credit_establishment_products p
    SET
      app_discount_pct = v_discount,
      updated_at = timezone('utc'::text, now())
    FROM public.credit_establishments ce
    WHERE p.establishment_id = ce.id
      AND p.company_id = p_company_id
      AND ce.company_id = p_company_id
      AND ce.event_id = v_event_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE
    UPDATE public.credit_establishment_products p
    SET
      app_discount_pct = v_discount,
      updated_at = timezone('utc'::text, now())
    WHERE p.company_id = p_company_id
      AND p.establishment_id = p_establishment_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_count', v_updated,
    'app_discount_pct', v_discount,
    'scope', v_scope
  );
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
            pr.app_discount_pct,
            public.credit_product_app_unit_price(pr.unit_price, pr.app_discount_pct) AS app_unit_price,
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
      pr.app_discount_pct,
      public.credit_product_app_unit_price(pr.unit_price, pr.app_discount_pct) AS app_unit_price,
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
  v_unit_price NUMERIC(12,2);
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

    v_unit_price := public.credit_product_app_unit_price(
      v_product.unit_price,
      v_product.app_discount_pct
    );

    IF v_unit_price <= 0 THEN
      RAISE EXCEPTION 'Preço com desconto inválido para "%".', v_product.name;
    END IF;

    v_line_total := round(v_unit_price * v_qty, 2);
    v_gross := round(v_gross + v_line_total, 2);

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'product_name', v_product.name,
        'quantity', v_qty,
        'unit_price', v_unit_price,
        'line_total', v_line_total,
        'list_unit_price', v_product.unit_price,
        'app_discount_pct', COALESCE(v_product.app_discount_pct, 0)
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

GRANT EXECUTE ON FUNCTION public.credit_product_app_unit_price(NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_credit_establishment_products(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_credit_establishment_product(
  UUID, UUID, TEXT, NUMERIC, TEXT, UUID, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER, NUMERIC
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_product_app_discount(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_event_credit_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_establishment_credit_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_credit_consumption_intent(UUID, JSONB, TEXT, UUID) TO authenticated;
