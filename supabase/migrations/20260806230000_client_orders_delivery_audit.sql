-- Fase 4: histórico de pedidos do cliente + auditoria de entrega.

ALTER TABLE public.credit_consumption_intents
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by_user_id UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.credit_consumption_intents.delivered_at IS
  'Momento em que o gestor confirmou a entrega e invalidou o QR.';
COMMENT ON COLUMN public.credit_consumption_intents.delivered_by_user_id IS
  'Operador que confirmou a entrega.';

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
      'Entrega confirmada; QR invalidado. Cliente=%s; itens=%s',
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
    'paid_at', v_intent.paid_at,
    'delivered_at', timezone('utc'::text, now()),
    'items', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_client_credit_consumption_orders(
  p_limit INTEGER DEFAULT 40,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rows JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      i.id,
      i.status,
      i.gross_amount,
      i.paid_at,
      i.delivered_at,
      i.delivery_token,
      i.delivery_token_expires_at,
      i.created_at,
      i.updated_at,
      i.establishment_id,
      ce.name AS establishment_name,
      i.event_id,
      e.title AS event_title,
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
    LEFT JOIN public.events e ON e.id = i.event_id
    WHERE i.client_user_id = v_user_id
      AND i.paid_at IS NOT NULL
    ORDER BY i.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 40), 100))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'items', COALESCE(v_rows, '[]'::jsonb)
  );
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
      COALESCE(
        NULLIF(trim(concat_ws(' ', pf.first_name, pf.last_name)), ''),
        pf.public_id,
        i.client_user_id::text
      ) AS client_label,
      pf.public_id AS client_public_id,
      i.establishment_id,
      ce.name AS establishment_name,
      i.event_id,
      e.title AS event_title,
      i.status,
      i.gross_amount,
      i.biometric_required,
      (i.biometric_confirmed_at IS NOT NULL) AS biometric_confirmed,
      i.spend_order_id,
      i.paid_at,
      i.delivered_at,
      i.delivery_token,
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
      ) AS items,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(hh)::jsonb ORDER BY hh.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT
            h.id,
            h.from_status,
            h.to_status,
            h.source,
            h.notes,
            h.created_at,
            h.changed_by_user_id,
            COALESCE(
              NULLIF(trim(concat_ws(' ', pf2.first_name, pf2.last_name)), ''),
              pf2.public_id,
              h.changed_by_user_id::text,
              'Sistema'
            ) AS changed_by_label
          FROM public.credit_consumption_intent_status_history h
          LEFT JOIN public.profiles pf2 ON pf2.id = h.changed_by_user_id
          WHERE h.intent_id = i.id
        ) hh
      ) AS status_history
    FROM public.credit_consumption_intents i
    JOIN public.credit_establishments ce ON ce.id = i.establishment_id
    LEFT JOIN public.events e ON e.id = i.event_id
    LEFT JOIN public.profiles pf ON pf.id = i.client_user_id
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

GRANT EXECUTE ON FUNCTION public.list_client_credit_consumption_orders(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_credit_consumption_delivery(UUID, TEXT, UUID) TO authenticated;
