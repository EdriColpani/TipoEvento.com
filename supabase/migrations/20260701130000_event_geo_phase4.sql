-- Fase 4: geo em ingressos do cliente + backfill admin

CREATE OR REPLACE FUNCTION public.get_my_client_tickets()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(row_payload ORDER BY created_at DESC)
      FROM (
        SELECT
          wa.created_at,
          jsonb_build_object(
            'id', wa.id,
            'code_wristbands', wa.code_wristbands,
            'status', wa.status,
            'created_at', wa.created_at,
            'event_type', wa.event_type,
            'event_data', wa.event_data,
            'wristbands', jsonb_build_object(
              'access_type', w.access_type,
              'price', w.price,
              'events', jsonb_build_object(
                'id', e.id,
                'title', e.title,
                'location', e.location,
                'address', e.address,
                'address_lat', e.address_lat,
                'address_lng', e.address_lng,
                'date', e.date
              )
            )
          ) AS row_payload
        FROM public.wristband_analytics wa
        INNER JOIN public.wristbands w ON w.id = wa.wristband_id
        INNER JOIN public.events e ON e.id = w.event_id
        WHERE
          wa.client_user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.receivables r
            WHERE r.client_user_id = auth.uid()
              AND (
                r.status = 'paid'
                OR COALESCE(r.payment_status::text, '') IN ('approved', 'authorized')
              )
              AND wa.id = ANY (COALESCE(r.wristband_analytics_ids, ARRAY[]::uuid[]))
          )
      ) AS rows
    ),
    '[]'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.list_admin_events_missing_geo(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COUNT(*)
  INTO v_total
  FROM public.events e
  WHERE COALESCE(TRIM(e.address), '') <> ''
    AND (e.address_lat IS NULL OR e.address_lng IS NULL);

  RETURN jsonb_build_object(
    'total', v_total,
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'title', x.title,
            'date', x.date,
            'location', x.location,
            'address', x.address,
            'status', x.status
          )
          ORDER BY x.date DESC NULLS LAST, x.title
        )
        FROM (
          SELECT e.id, e.title, e.date, e.location, e.address, e.status
          FROM public.events e
          WHERE COALESCE(TRIM(e.address), '') <> ''
            AND (e.address_lat IS NULL OR e.address_lng IS NULL)
          ORDER BY e.date DESC NULLS LAST, e.title
          LIMIT GREATEST(p_limit, 1)
          OFFSET GREATEST(p_offset, 0)
        ) x
      ),
      '[]'::jsonb
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_admin_event_geo(
  p_event_id UUID,
  p_address TEXT,
  p_address_lat DOUBLE PRECISION,
  p_address_lng DOUBLE PRECISION,
  p_address_place_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Evento inválido.';
  END IF;

  IF p_address_lat IS NULL OR p_address_lng IS NULL THEN
    RAISE EXCEPTION 'Coordenadas inválidas.';
  END IF;

  UPDATE public.events
  SET
    address = NULLIF(TRIM(p_address), ''),
    address_lat = p_address_lat,
    address_lng = p_address_lng,
    address_place_id = NULLIF(TRIM(p_address_place_id), '')
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', p_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_events_missing_geo(INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_event_geo(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO authenticated;
