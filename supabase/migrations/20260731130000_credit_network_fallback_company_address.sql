-- Fallback: endereço da empresa no mapa quando o estabelecimento não tem endereço próprio.

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
          e.address,
          e.address_lat,
          e.address_lng,
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
        e.title AS event_title,
        COALESCE(
          NULLIF(trim(ce.address), ''),
          e.address,
          NULLIF(trim(concat_ws(
            ', ',
            NULLIF(trim(concat_ws(' ', c.street, c.number)), ''),
            NULLIF(trim(c.neighborhood), ''),
            NULLIF(trim(c.city), ''),
            NULLIF(trim(c.state), ''),
            NULLIF(trim(c.cep), '')
          )), '')
        ) AS address,
        COALESCE(ce.address_lat, e.address_lat) AS address_lat,
        COALESCE(ce.address_lng, e.address_lng) AS address_lng,
        COALESCE(
          NULLIF(trim(e.location), ''),
          NULLIF(trim(ce.address), ''),
          e.address,
          NULLIF(trim(concat_ws(', ', NULLIF(trim(c.city), ''), NULLIF(trim(c.state), ''))), '')
        ) AS location
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

GRANT EXECUTE ON FUNCTION public.list_credit_acceptance_network() TO authenticated;
