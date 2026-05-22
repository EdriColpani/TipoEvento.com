-- Corrige erro 500: policy em wristbands que referenciava wristband_analytics causava recursão no PostgREST.

DROP POLICY IF EXISTS "wristbands_select_client_ticket" ON public.wristbands;

-- RPC reescrita com subquery (compatível) e comparação segura de payment_status
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
