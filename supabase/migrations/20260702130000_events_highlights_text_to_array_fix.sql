-- Corrige coluna highlights se tiver sido criada como text (JSON) em vez de text[].

CREATE OR REPLACE FUNCTION public.migrate_events_highlights_to_text_array(p_input text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trimmed text;
  v_result text[];
BEGIN
  IF p_input IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  v_trimmed := btrim(p_input);
  IF v_trimmed = '' THEN
    RETURN '{}'::text[];
  END IF;

  IF v_trimmed LIKE '[%' THEN
    SELECT COALESCE(array_agg(elem::text), '{}'::text[])
    INTO v_result
    FROM jsonb_array_elements_text(v_trimmed::jsonb) AS elem;
    RETURN COALESCE(v_result, '{}'::text[]);
  END IF;

  IF v_trimmed LIKE '{%' AND v_trimmed LIKE '%}' THEN
    RETURN v_trimmed::text[];
  END IF;

  RETURN ARRAY[v_trimmed];
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'highlights'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE public.events
      ALTER COLUMN highlights DROP DEFAULT;

    ALTER TABLE public.events
      ALTER COLUMN highlights TYPE text[]
      USING public.migrate_events_highlights_to_text_array(highlights::text);

    ALTER TABLE public.events
      ALTER COLUMN highlights SET DEFAULT '{}'::text[];

    ALTER TABLE public.events
      ALTER COLUMN highlights SET NOT NULL;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.migrate_events_highlights_to_text_array(text);
