-- Contato público (landing) + caixa de mensagens para Admin Master

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  read_at TIMESTAMPTZ NULL,
  resolved_at TIMESTAMPTZ NULL,
  handled_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status_created
  ON public.contact_messages (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_public_contact_info()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'phone', c.phone,
    'company_name', COALESCE(c.trade_name, c.corporate_name, 'EventFest')
  )
  FROM public.companies c
  WHERE c.phone IS NOT NULL
    AND trim(c.phone) <> ''
  ORDER BY c.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.create_public_contact_message(
  p_name TEXT,
  p_phone TEXT,
  p_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := trim(COALESCE(p_name, ''));
  v_phone TEXT := regexp_replace(trim(COALESCE(p_phone, '')), '\D', '', 'g');
  v_msg TEXT := trim(COALESCE(p_message, ''));
  v_id UUID;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe seu nome.';
  END IF;
  IF v_phone = '' OR length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Informe um telefone válido.';
  END IF;
  IF v_msg = '' OR length(v_msg) < 5 THEN
    RAISE EXCEPTION 'Mensagem muito curta.';
  END IF;

  INSERT INTO public.contact_messages (name, phone, message)
  VALUES (v_name, v_phone, v_msg)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_contact_messages(
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_status TEXT := NULLIF(trim(COALESCE(p_status, '')), '');
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.id,
      m.name,
      m.phone,
      m.message,
      m.status,
      m.created_at,
      m.read_at,
      m.resolved_at,
      m.handled_by,
      COALESCE(NULLIF(p.full_name, ''), p.email, m.handled_by::text) AS handled_by_label
    FROM public.contact_messages m
    LEFT JOIN public.profiles p ON p.id = m.handled_by
    WHERE v_status IS NULL OR m.status = v_status
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 300))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('items', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_admin_contact_message_status(
  p_message_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT := trim(COALESCE(p_status, ''));
  v_actor UUID := auth.uid();
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'Mensagem inválida.';
  END IF;
  IF v_status NOT IN ('new', 'read', 'resolved') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  UPDATE public.contact_messages m
  SET
    status = v_status,
    read_at = CASE WHEN v_status IN ('read', 'resolved') AND m.read_at IS NULL THEN timezone('utc'::text, now()) ELSE m.read_at END,
    resolved_at = CASE WHEN v_status = 'resolved' THEN timezone('utc'::text, now()) ELSE NULL END,
    handled_by = v_actor
  WHERE m.id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mensagem não encontrada.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_contact_info() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_contact_message(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_contact_messages(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_contact_message_status(UUID, TEXT) TO authenticated;
