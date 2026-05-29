-- Feedback da landing (visitantes)

CREATE TABLE IF NOT EXISTS public.landing_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_landing_feedback_created
  ON public.landing_feedback (created_at DESC);

ALTER TABLE public.landing_feedback ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_public_landing_feedback(p_message TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg TEXT := trim(COALESCE(p_message, ''));
  v_id UUID;
BEGIN
  IF v_msg = '' OR length(v_msg) < 5 THEN
    RAISE EXCEPTION 'Escreva um feedback com pelo menos 5 caracteres.';
  END IF;
  IF length(v_msg) > 2000 THEN
    RAISE EXCEPTION 'Feedback muito longo (máx. 2000 caracteres).';
  END IF;

  INSERT INTO public.landing_feedback (message)
  VALUES (v_msg)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_landing_feedback(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_landing_feedback(TEXT) TO anon, authenticated;
