-- Avaliações de evento pelo cliente (1 por usuário/evento) + leitura pelo gestor.

CREATE TABLE IF NOT EXISTS public.event_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NULL CHECK (comment IS NULL OR char_length(btrim(comment)) <= 1000),
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  wristband_analytics_id UUID NULL REFERENCES public.wristband_analytics(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_reviews_event_user_unique UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS event_reviews_event_id_idx ON public.event_reviews (event_id);
CREATE INDEX IF NOT EXISTS event_reviews_user_id_idx ON public.event_reviews (user_id);
CREATE INDEX IF NOT EXISTS event_reviews_event_rating_idx ON public.event_reviews (event_id, rating);

ALTER TABLE public.event_reviews ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.client_has_ticket_for_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wristband_analytics wa
    INNER JOIN public.wristbands w ON w.id = wa.wristband_id
    WHERE w.event_id = p_event_id
      AND wa.status IS DISTINCT FROM 'cancelled'
      AND (
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
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_read_event_reviews(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.user_companies uc
          WHERE uc.company_id = e.company_id
            AND uc.user_id = auth.uid()
        )
      )
  );
$$;

DROP POLICY IF EXISTS event_reviews_select_own ON public.event_reviews;
CREATE POLICY event_reviews_select_own
  ON public.event_reviews
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS event_reviews_select_manager ON public.event_reviews;
CREATE POLICY event_reviews_select_manager
  ON public.event_reviews
  FOR SELECT
  TO authenticated
  USING (public.user_can_read_event_reviews(event_id));

DROP POLICY IF EXISTS event_reviews_insert_own ON public.event_reviews;
CREATE POLICY event_reviews_insert_own
  ON public.event_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.client_has_ticket_for_event(event_id)
  );

DROP POLICY IF EXISTS event_reviews_update_own ON public.event_reviews;
CREATE POLICY event_reviews_update_own
  ON public.event_reviews
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND public.client_has_ticket_for_event(event_id)
  );

CREATE OR REPLACE FUNCTION public.upsert_my_event_review(
  p_event_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT '{}'::text[],
  p_wristband_analytics_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_comment TEXT := NULLIF(btrim(COALESCE(p_comment, '')), '');
  v_tags TEXT[] := COALESCE(p_tags, '{}'::text[]);
  v_row public.event_reviews%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Faça login para avaliar o evento.';
  END IF;
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Evento inválido.';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Escolha uma nota de 1 a 5.';
  END IF;
  IF v_comment IS NOT NULL AND char_length(v_comment) > 1000 THEN
    RAISE EXCEPTION 'O comentário pode ter no máximo 1000 caracteres.';
  END IF;
  IF COALESCE(array_length(v_tags, 1), 0) > 8 THEN
    RAISE EXCEPTION 'Selecione no máximo 8 temas.';
  END IF;
  IF NOT public.client_has_ticket_for_event(p_event_id) THEN
    RAISE EXCEPTION 'Só quem tem ingresso deste evento pode avaliar.';
  END IF;

  IF p_wristband_analytics_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.wristband_analytics wa
      INNER JOIN public.wristbands w ON w.id = wa.wristband_id
      WHERE wa.id = p_wristband_analytics_id
        AND w.event_id = p_event_id
        AND (
          wa.client_user_id = v_user
          OR EXISTS (
            SELECT 1
            FROM public.receivables r
            WHERE r.client_user_id = v_user
              AND wa.id = ANY (COALESCE(r.wristband_analytics_ids, ARRAY[]::uuid[]))
          )
        )
    ) THEN
      p_wristband_analytics_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.event_reviews AS er (
    event_id, user_id, rating, comment, tags, wristband_analytics_id, updated_at
  )
  VALUES (
    p_event_id, v_user, p_rating, v_comment, v_tags, p_wristband_analytics_id, now()
  )
  ON CONFLICT (event_id, user_id) DO UPDATE
  SET
    rating = EXCLUDED.rating,
    comment = EXCLUDED.comment,
    tags = EXCLUDED.tags,
    wristband_analytics_id = COALESCE(EXCLUDED.wristband_analytics_id, er.wristband_analytics_id),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'event_id', v_row.event_id,
    'user_id', v_row.user_id,
    'rating', v_row.rating,
    'comment', v_row.comment,
    'tags', to_jsonb(v_row.tags),
    'wristband_analytics_id', v_row.wristband_analytics_id,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_event_reviews()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(er.event_id::text, jsonb_build_object(
        'id', er.id,
        'event_id', er.event_id,
        'rating', er.rating,
        'comment', er.comment,
        'tags', to_jsonb(er.tags),
        'updated_at', er.updated_at
      ))
      FROM public.event_reviews er
      WHERE er.user_id = auth.uid()
    ),
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.get_manager_event_reviews(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg NUMERIC;
  v_count INTEGER;
  v_items JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF NOT public.user_can_read_event_reviews(p_event_id) THEN
    RAISE EXCEPTION 'Sem permissão para ver avaliações deste evento.';
  END IF;

  SELECT
    COALESCE(round(avg(er.rating)::numeric, 2), 0),
    count(*)::integer
  INTO v_avg, v_count
  FROM public.event_reviews er
  WHERE er.event_id = p_event_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', er.id,
        'rating', er.rating,
        'comment', er.comment,
        'tags', to_jsonb(er.tags),
        'created_at', er.created_at,
        'updated_at', er.updated_at
      )
      ORDER BY er.updated_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.event_reviews er
  WHERE er.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'average_rating', v_avg,
    'reviews_count', v_count,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_has_ticket_for_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_read_event_reviews(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_event_review(UUID, INTEGER, TEXT, TEXT[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_event_reviews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_manager_event_reviews(UUID) TO authenticated;
