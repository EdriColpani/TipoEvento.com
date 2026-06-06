-- Corrige RPC da vitrine: STABLE não pode fazer INSERT no cache (erro 0A000 via PostgREST).

CREATE OR REPLACE FUNCTION public.get_event_ticket_availability(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_types JSONB := '[]'::jsonb;
  v_today DATE := CURRENT_DATE;
  v_cached JSONB;
  v_cache_expires TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  SELECT c.payload, c.expires_at
  INTO v_cached, v_cache_expires
  FROM public.event_availability_cache c
  WHERE c.event_id = p_event_id
    AND c.expires_at > timezone('utc'::text, now());

  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT e.inventory_mode
  INTO v_mode
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;

  IF v_mode = 'counter' THEN
    SELECT COALESCE(jsonb_agg(row_payload ORDER BY sort_price, sort_name), '[]'::jsonb)
    INTO v_types
    FROM (
      SELECT jsonb_build_object(
        'id', eb.wristband_id,
        'wristband_id', eb.wristband_id,
        'batch_id', eb.id,
        'name', eb.name,
        'price', eb.price::numeric,
        'available', public.batch_inventory_available(eb.id),
        'start_date', eb.start_date,
        'end_date', eb.end_date,
        'batch_active', (v_today BETWEEN eb.start_date AND eb.end_date),
        'sales_open', (v_today BETWEEN eb.start_date AND eb.end_date)
      ) AS row_payload,
      eb.price AS sort_price,
      eb.name AS sort_name
      FROM public.event_batches eb
      INNER JOIN public.batch_inventory bi ON bi.batch_id = eb.id
      WHERE eb.event_id = p_event_id
        AND eb.price > 0
        AND eb.wristband_id IS NOT NULL
        AND public.batch_inventory_available(eb.id) > 0
    ) sub;
  ELSE
    SELECT COALESCE(jsonb_agg(row_payload ORDER BY sort_price, sort_name), '[]'::jsonb)
    INTO v_types
    FROM (
      SELECT jsonb_build_object(
        'id', w.id,
        'wristband_id', w.id,
        'batch_id', NULL,
        'name', w.access_type,
        'price', w.price::numeric,
        'available', (
          SELECT COUNT(*)::INTEGER
          FROM public.wristband_analytics wa
          WHERE wa.wristband_id = w.id
            AND wa.status = 'active'
            AND wa.client_user_id IS NULL
        ),
        'start_date', NULL,
        'end_date', NULL,
        'batch_active', true,
        'sales_open', true
      ) AS row_payload,
      w.price AS sort_price,
      w.access_type AS sort_name
      FROM public.wristbands w
      WHERE w.event_id = p_event_id
        AND w.status = 'active'
        AND COALESCE(w.price, 0) > 0
        AND EXISTS (
          SELECT 1
          FROM public.wristband_analytics wa
          WHERE wa.wristband_id = w.id
            AND wa.status = 'active'
            AND wa.client_user_id IS NULL
        )
    ) sub;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'inventory_mode', v_mode,
    'ticket_types', v_types,
    'cached', false
  );

  INSERT INTO public.event_availability_cache (event_id, payload, expires_at)
  VALUES (
    p_event_id,
    v_result,
    timezone('utc'::text, now()) + interval '3 seconds'
  )
  ON CONFLICT (event_id) DO UPDATE
  SET payload = EXCLUDED.payload,
      expires_at = EXCLUDED.expires_at,
      updated_at = timezone('utc'::text, now());

  RETURN v_result;
END;
$$;
