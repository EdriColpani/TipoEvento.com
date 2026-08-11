-- Pré-visualização da entrega após leitura do QR (sem gravar). Confirmação separada em complete_credit_consumption_delivery.

CREATE OR REPLACE FUNCTION public.preview_credit_consumption_delivery(
  p_company_id UUID,
  p_delivery_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  IF p_company_id IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'Informe o QR do pedido (EFDEL).';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id, v_user_id) THEN
    RAISE EXCEPTION 'Sem permissão para este estabelecimento.';
  END IF;

  SELECT * INTO v_intent
  FROM public.credit_consumption_intents i
  WHERE i.delivery_token = v_token
    AND i.company_id = p_company_id;

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
    v_block_reason := 'QR de entrega expirado.';
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
    'items', v_items,
    'can_confirm', v_can_confirm,
    'block_reason', v_block_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_credit_consumption_delivery(UUID, TEXT) TO authenticated;
