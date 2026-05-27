-- Carteira cliente: sempre exibir saldo/extrato/rede; recarga só com módulo global ligado

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
  v_bio_threshold NUMERIC(12, 2);
  v_balance NUMERIC(12, 2);
BEGIN
  v_module := public.credit_module_globally_enabled();
  v_commission := public.get_credit_consumption_commission_pct();
  v_bio_threshold := public.get_credit_spend_biometric_threshold();

  SELECT COALESCE(a.balance_cached, 0)
  INTO v_balance
  FROM public.client_credit_accounts a
  WHERE a.user_id = auth.uid();

  RETURN jsonb_build_object(
    'module_enabled', v_module,
    'wallet_visible', true,
    'can_topup', v_module,
    'can_use', v_module OR COALESCE(v_balance, 0) > 0,
    'consumption_commission_pct', v_commission,
    'biometric_threshold', v_bio_threshold,
    'biometric_enabled', v_bio_threshold > 0,
    'mobile_wallet_ready', true,
    'message', CASE
      WHEN NOT v_module THEN
        'Novas recargas estão pausadas. Seu saldo e extrato continuam disponíveis.'
      ELSE NULL
    END
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
  v_module BOOLEAN;
BEGIN
  v_module := public.credit_module_globally_enabled();

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
          AND public.company_allows_credit_consumption(c.id)
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
        AND public.company_allows_credit_consumption(c.id)
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'module_enabled', v_module,
    'events', v_events,
    'establishments', v_establishments,
    'message', CASE
      WHEN NOT v_module THEN
        'Novas recargas pausadas; pontos abaixo aceitam crédito já existente na carteira.'
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_credit_wallet_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_credit_acceptance_network() TO authenticated;
