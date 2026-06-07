-- Corrige fila virtual: admissão imediata no join (sem depender só do pg_cron) e validação auth.uid().

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.join_event_checkout_queue(
  p_event_id UUID,
  p_client_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_existing public.event_checkout_queue_sessions%ROWTYPE;
  v_token TEXT;
  v_position INTEGER;
  v_admit_rate INTEGER;
BEGIN
  IF p_event_id IS NULL OR p_client_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros obrigatórios ausentes.';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_client_user_id THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  SELECT e.checkout_queue_enabled, e.checkout_admit_per_minute
  INTO v_enabled, v_admit_rate
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.';
  END IF;

  IF NOT COALESCE(v_enabled, false) THEN
    v_token := encode(gen_random_bytes(16), 'hex');
    RETURN jsonb_build_object(
      'ok', true,
      'queue_enabled', false,
      'status', 'admitted',
      'session_token', v_token,
      'position', 0,
      'wait_estimate_seconds', 0
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.event_checkout_queue_sessions q
  WHERE q.event_id = p_event_id
    AND q.client_user_id = p_client_user_id
    AND q.status IN ('waiting', 'admitted')
    AND (q.expires_at IS NULL OR q.expires_at > timezone('utc'::text, now()))
  ORDER BY q.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_token := encode(gen_random_bytes(16), 'hex');

    SELECT COUNT(*)::INTEGER + 1
    INTO v_position
    FROM public.event_checkout_queue_sessions q
    WHERE q.event_id = p_event_id
      AND q.status = 'waiting';

    INSERT INTO public.event_checkout_queue_sessions (
      event_id, client_user_id, session_token, status, queue_position
    ) VALUES (
      p_event_id, p_client_user_id, v_token, 'waiting', v_position
    );

    v_existing.session_token := v_token;
  END IF;

  PERFORM public.admit_event_checkout_queue_batch(
    p_event_id,
    GREATEST(COALESCE(v_admit_rate, 120), 1)
  );

  SELECT *
  INTO v_existing
  FROM public.event_checkout_queue_sessions q
  WHERE q.session_token = v_existing.session_token
    AND q.event_id = p_event_id
    AND q.client_user_id = p_client_user_id;

  IF v_existing.status = 'admitted' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'queue_enabled', true,
      'status', 'admitted',
      'session_token', v_existing.session_token,
      'position', 0,
      'wait_estimate_seconds', 0,
      'expires_at', v_existing.expires_at
    );
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_position
  FROM public.event_checkout_queue_sessions q
  WHERE q.event_id = p_event_id
    AND q.status = 'waiting'
    AND q.created_at <= v_existing.created_at;

  RETURN jsonb_build_object(
    'ok', true,
    'queue_enabled', true,
    'status', 'waiting',
    'session_token', v_existing.session_token,
    'position', v_position,
    'wait_estimate_seconds', GREATEST(
      1,
      CEIL(v_position::numeric / GREATEST(COALESCE(v_admit_rate, 120), 1)::numeric * 60)::INTEGER
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.poll_event_checkout_queue(p_session_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.event_checkout_queue_sessions%ROWTYPE;
  v_position INTEGER;
  v_admit_rate INTEGER;
  v_queue_enabled BOOLEAN;
BEGIN
  SELECT *
  INTO v_row
  FROM public.event_checkout_queue_sessions q
  WHERE q.session_token = NULLIF(trim(p_session_token), '');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão da fila não encontrada.');
  END IF;

  SELECT e.checkout_queue_enabled, e.checkout_admit_per_minute
  INTO v_queue_enabled, v_admit_rate
  FROM public.events e
  WHERE e.id = v_row.event_id;

  IF v_row.status = 'expired'
     OR (v_row.expires_at IS NOT NULL AND v_row.expires_at <= timezone('utc'::text, now())) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Sua sessão de compra expirou. Entre na fila novamente.',
      'status', 'expired',
      'queue_enabled', COALESCE(v_queue_enabled, false)
    );
  END IF;

  IF v_row.status = 'waiting' AND COALESCE(v_queue_enabled, false) THEN
    PERFORM public.admit_event_checkout_queue_batch(
      v_row.event_id,
      GREATEST(COALESCE(v_admit_rate, 120), 1)
    );

    SELECT *
    INTO v_row
    FROM public.event_checkout_queue_sessions q
    WHERE q.id = v_row.id;
  END IF;

  IF v_row.status = 'admitted' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'queue_enabled', COALESCE(v_queue_enabled, false),
      'status', 'admitted',
      'session_token', v_row.session_token,
      'position', 0,
      'wait_estimate_seconds', 0,
      'expires_at', v_row.expires_at
    );
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_position
  FROM public.event_checkout_queue_sessions q
  WHERE q.event_id = v_row.event_id
    AND q.status = 'waiting'
    AND q.created_at <= v_row.created_at;

  RETURN jsonb_build_object(
    'ok', true,
    'queue_enabled', true,
    'status', 'waiting',
    'session_token', v_row.session_token,
    'position', v_position,
    'wait_estimate_seconds', GREATEST(
      1,
      CEIL(v_position::numeric / GREATEST(COALESCE(v_admit_rate, 120), 1)::numeric * 60)::INTEGER
    )
  );
END;
$$;
