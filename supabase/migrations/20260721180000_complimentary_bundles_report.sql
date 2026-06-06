-- Relatório de pacotes cortesia — exclusivo gestor PRO (não Admin Master).

CREATE OR REPLACE FUNCTION public.get_manager_complimentary_bundles_report(
  p_event_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search TEXT;
  v_total_bundles INTEGER := 0;
  v_active_bundles INTEGER := 0;
  v_total_seats INTEGER := 0;
  v_redeemed_seats INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF public.is_admin_master() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manager_only');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 2
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manager_only');
  END IF;

  v_search := NULLIF(lower(trim(COALESCE(p_search, ''))), '');

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE cb.status = 'active')::INTEGER,
    COALESCE(SUM(cb.quantity), 0)::INTEGER,
    COALESCE(SUM(sub.redeemed_count), 0)::INTEGER
  INTO v_total_bundles, v_active_bundles, v_total_seats, v_redeemed_seats
  FROM public.complimentary_bundles cb
  INNER JOIN public.events e ON e.id = cb.event_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS redeemed_count
    FROM public.complimentary_bundle_seats s
    WHERE s.bundle_id = cb.id
      AND s.status = 'redeemed'
  ) sub ON true
  WHERE public.user_can_manage_event(cb.event_id)
    AND (p_event_id IS NULL OR cb.event_id = p_event_id)
    AND (
      p_status IS NULL
      OR NULLIF(trim(p_status), '') IS NULL
      OR cb.status = NULLIF(trim(p_status), '')
    )
    AND (
      v_search IS NULL
      OR lower(cb.recipient_name) LIKE '%' || v_search || '%'
      OR lower(COALESCE(cb.recipient_email, '')) LIKE '%' || v_search || '%'
      OR lower(e.title) LIKE '%' || v_search || '%'
    );

  RETURN jsonb_build_object(
    'ok', true,
    'summary', jsonb_build_object(
      'total_bundles', v_total_bundles,
      'active_bundles', v_active_bundles,
      'total_seats', v_total_seats,
      'redeemed_seats', v_redeemed_seats,
      'pending_seats', GREATEST(v_total_seats - v_redeemed_seats, 0)
    ),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(row_payload ORDER BY created_at DESC)
        FROM (
          SELECT jsonb_build_object(
            'bundle_id', cb.id,
            'event_id', cb.event_id,
            'event_title', e.title,
            'event_date', e.date,
            'batch_id', cb.batch_id,
            'batch_name', eb.name,
            'recipient_name', cb.recipient_name,
            'recipient_email', cb.recipient_email,
            'quantity', cb.quantity,
            'redeemed_count', sub.redeemed_count,
            'available_count', sub.available_count,
            'status', cb.status,
            'expires_at', cb.expires_at,
            'created_at', cb.created_at,
            'holder_claimed', cb.holder_user_id IS NOT NULL,
            'holder_claimed_at', cb.holder_claimed_at,
            'email_sent_at', cb.email_sent_at,
            'notes', cb.notes,
            'seats', COALESCE(seats.payload, '[]'::jsonb)
          ) AS row_payload,
          cb.created_at
          FROM public.complimentary_bundles cb
          INNER JOIN public.events e ON e.id = cb.event_id
          INNER JOIN public.event_batches eb ON eb.id = cb.batch_id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) FILTER (WHERE s.status = 'redeemed')::INTEGER AS redeemed_count,
              COUNT(*) FILTER (WHERE s.status = 'available')::INTEGER AS available_count
            FROM public.complimentary_bundle_seats s
            WHERE s.bundle_id = cb.id
          ) sub ON true
          LEFT JOIN LATERAL (
            SELECT jsonb_agg(seat_row ORDER BY seat_number ASC) AS payload
            FROM (
              SELECT jsonb_build_object(
                'seat_number', s.seat_number,
                'status', s.status,
                'redeemed_at', s.redeemed_at,
                'redeemer_name', NULLIF(trim(
                  COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')
                ), ''),
                'redeemer_email', au.email,
                'ticket_code', wa.code_wristbands,
                'analytics_id', s.wristband_analytics_id
              ) AS seat_row,
              s.seat_number
              FROM public.complimentary_bundle_seats s
              LEFT JOIN public.profiles p ON p.id = s.redeemed_by_user_id
              LEFT JOIN auth.users au ON au.id = s.redeemed_by_user_id
              LEFT JOIN public.wristband_analytics wa ON wa.id = s.wristband_analytics_id
              WHERE s.bundle_id = cb.id
            ) seat_inner
          ) seats ON true
          WHERE public.user_can_manage_event(cb.event_id)
            AND (p_event_id IS NULL OR cb.event_id = p_event_id)
            AND (
              p_status IS NULL
              OR NULLIF(trim(p_status), '') IS NULL
              OR cb.status = NULLIF(trim(p_status), '')
            )
            AND (
              v_search IS NULL
              OR lower(cb.recipient_name) LIKE '%' || v_search || '%'
              OR lower(COALESCE(cb.recipient_email, '')) LIKE '%' || v_search || '%'
              OR lower(e.title) LIKE '%' || v_search || '%'
            )
        ) report_rows
      ),
      '[]'::jsonb
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manager_complimentary_report_events()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF public.is_admin_master() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manager_only');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'events', COALESCE(
      (
        SELECT jsonb_agg(row_payload ORDER BY title ASC)
        FROM (
          SELECT jsonb_build_object(
            'id', e.id,
            'title', e.title
          ) AS row_payload,
          e.title
          FROM public.events e
          WHERE e.inventory_mode = 'counter'
            AND public.user_can_manage_event(e.id)
            AND EXISTS (
              SELECT 1
              FROM public.complimentary_bundles cb
              WHERE cb.event_id = e.id
            )
        ) ev
      ),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_manager_complimentary_bundles_report(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_manager_complimentary_report_events() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_manager_complimentary_bundles_report(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manager_complimentary_report_events() TO authenticated;

COMMENT ON FUNCTION public.get_manager_complimentary_bundles_report IS
  'Relatório de pacotes cortesia counter — apenas gestor PRO (não Admin Master).';
COMMENT ON FUNCTION public.list_manager_complimentary_report_events IS
  'Eventos counter com pacotes cortesia para filtro do relatório gestor.';
