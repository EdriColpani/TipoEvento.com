-- Relatório consolidado de feedback para gestores (todos os eventos acessíveis).

CREATE OR REPLACE FUNCTION public.get_manager_feedback_report()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_items JSONB;
  v_events JSONB;
  v_count INTEGER;
  v_avg NUMERIC;
  v_dist JSONB;
  v_tags JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  WITH accessible_events AS (
    SELECT e.id, e.title, e.date
    FROM public.events e
    WHERE e.created_by = v_user
       OR EXISTS (
         SELECT 1
         FROM public.user_companies uc
         WHERE uc.company_id = e.company_id
           AND uc.user_id = v_user
       )
  ),
  reviews AS (
    SELECT
      er.id,
      er.event_id,
      ae.title AS event_title,
      ae.date AS event_date,
      er.rating,
      er.comment,
      er.tags,
      er.created_at,
      er.updated_at
    FROM public.event_reviews er
    INNER JOIN accessible_events ae ON ae.id = er.event_id
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'event_id', r.event_id,
            'event_title', r.event_title,
            'event_date', r.event_date,
            'rating', r.rating,
            'comment', r.comment,
            'tags', to_jsonb(r.tags),
            'created_at', r.created_at,
            'updated_at', r.updated_at
          )
          ORDER BY r.updated_at DESC
        )
        FROM reviews r
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('id', ae.id, 'title', ae.title, 'date', ae.date)
          ORDER BY ae.date DESC NULLS LAST, ae.title
        )
        FROM accessible_events ae
        WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.event_id = ae.id)
      ),
      '[]'::jsonb
    ),
    (SELECT count(*)::integer FROM reviews),
    (SELECT COALESCE(round(avg(rating)::numeric, 2), 0) FROM reviews),
    (
      SELECT jsonb_build_object(
        '1', count(*) FILTER (WHERE rating = 1),
        '2', count(*) FILTER (WHERE rating = 2),
        '3', count(*) FILTER (WHERE rating = 3),
        '4', count(*) FILTER (WHERE rating = 4),
        '5', count(*) FILTER (WHERE rating = 5)
      )
      FROM reviews
    ),
    COALESCE(
      (
        SELECT jsonb_object_agg(tag, cnt)
        FROM (
          SELECT unnest(tags) AS tag, count(*)::integer AS cnt
          FROM reviews
          GROUP BY 1
          ORDER BY 2 DESC, 1
        ) t
      ),
      '{}'::jsonb
    )
  INTO v_items, v_events, v_count, v_avg, v_dist, v_tags;

  RETURN jsonb_build_object(
    'reviews_count', COALESCE(v_count, 0),
    'average_rating', COALESCE(v_avg, 0),
    'rating_distribution', COALESCE(v_dist, '{}'::jsonb),
    'tag_counts', COALESCE(v_tags, '{}'::jsonb),
    'events', COALESCE(v_events, '[]'::jsonb),
    'items', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_manager_feedback_report() TO authenticated;
