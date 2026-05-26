-- Fase 2: status da carteira, rede de aceitação, polling de recarga

CREATE OR REPLACE FUNCTION public.get_credit_wallet_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module BOOLEAN;
  v_commission NUMERIC(5, 2);
BEGIN
  v_module := public.credit_module_globally_enabled();
  v_commission := public.get_credit_consumption_commission_pct();

  RETURN jsonb_build_object(
    'module_enabled', v_module,
    'can_topup', v_module,
    'can_use', v_module,
    'consumption_commission_pct', v_commission,
    'message', CASE
      WHEN NOT v_module THEN
        'O módulo de créditos EventFest ainda não está disponível. Tente novamente em breve.'
      ELSE NULL
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_credit_topup_order_status(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.credit_topup_orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido inválido.';
  END IF;

  SELECT * INTO v_row
  FROM public.credit_topup_orders
  WHERE id = p_order_id
    AND client_user_id = auth.uid();

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'order_id', v_row.id,
    'status', v_row.status,
    'gross_paid_amount', v_row.gross_paid_amount,
    'credit_granted_amount', v_row.credit_granted_amount,
    'paid_at', v_row.paid_at,
    'public_description', v_row.public_description
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_credit_acceptance_network()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events JSONB := '[]'::jsonb;
  v_establishments JSONB := '[]'::jsonb;
  v_has_events BOOLEAN;
  v_has_est_col BOOLEAN;
BEGIN
  IF NOT public.credit_module_globally_enabled() THEN
    RETURN jsonb_build_object(
      'module_enabled', false,
      'events', '[]'::jsonb,
      'establishments', '[]'::jsonb,
      'message', 'Rede de créditos indisponível no momento.'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'events'
  ) INTO v_has_events;

  IF v_has_events THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'events'
        AND column_name = 'credit_consumption_enabled'
    ) INTO v_has_est_col;

    IF v_has_est_col THEN
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.event_date ASC, t.title ASC), '[]'::jsonb)
      INTO v_events
      FROM (
        SELECT
          e.id AS event_id,
          e.title,
          e.date AS event_date,
          e.time AS event_time,
          e.location,
          e.credit_consumption_enabled,
          c.id AS company_id,
          c.corporate_name AS company_name
        FROM public.events e
        INNER JOIN public.companies c ON c.id = e.company_id
        WHERE COALESCE(e.is_active, true) = true
          AND COALESCE(e.credit_consumption_enabled, false) = true
          AND c.billing_plan IN (
            'ticket_plus_consumption'::public.billing_plan_type,
            'consumption_or_license'::public.billing_plan_type
          )
      ) t;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'credit_establishments'
  ) THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
    INTO v_establishments
    FROM (
      SELECT
        ce.id AS establishment_id,
        ce.name,
        ce.event_id,
        ce.company_id,
        c.corporate_name AS company_name,
        e.title AS event_title
      FROM public.credit_establishments ce
      INNER JOIN public.companies c ON c.id = ce.company_id
      LEFT JOIN public.events e ON e.id = ce.event_id
      WHERE ce.active = true
        AND ce.credit_acceptance_enabled = true
        AND c.billing_plan IN (
          'ticket_plus_consumption'::public.billing_plan_type,
          'consumption_or_license'::public.billing_plan_type
        )
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'module_enabled', true,
    'events', v_events,
    'establishments', v_establishments,
    'message', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_credit_wallet_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_credit_topup_order_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_credit_acceptance_network() TO authenticated;
