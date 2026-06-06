-- Fase 3 grande porte: fila virtual, cache de disponibilidade, rate limit, webhook assíncrono.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS checkout_queue_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkout_admit_per_minute INTEGER NOT NULL DEFAULT 120
    CHECK (checkout_admit_per_minute >= 10 AND checkout_admit_per_minute <= 10000),
  ADD COLUMN IF NOT EXISTS checkout_async_webhook BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkout_rate_limit_per_minute INTEGER NOT NULL DEFAULT 30
    CHECK (checkout_rate_limit_per_minute >= 5 AND checkout_rate_limit_per_minute <= 500);

COMMENT ON COLUMN public.events.checkout_queue_enabled IS
  'Fila virtual antes do checkout (eventos de alto tráfego).';
COMMENT ON COLUMN public.events.checkout_async_webhook IS
  'Webhook MP enfileira processamento e responde 200 imediatamente.';

CREATE TABLE IF NOT EXISTS public.event_checkout_queue_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'admitted', 'consumed', 'expired')),
  queue_position INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  admitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_checkout_queue_event_status
  ON public.event_checkout_queue_sessions (event_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_event_checkout_queue_client
  ON public.event_checkout_queue_sessions (event_id, client_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.event_availability_cache (
  event_id UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.checkout_rate_limit_buckets (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL,
  window_minute TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, client_user_id, window_minute)
);

CREATE TABLE IF NOT EXISTS public.payment_webhook_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mp_payment_id TEXT NOT NULL,
  external_reference TEXT,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  payment_status TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  processed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_jobs_mp_payment_id
  ON public.payment_webhook_jobs (mp_payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_jobs_pending
  ON public.payment_webhook_jobs (created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.event_checkout_queue_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_checkout_queue_select_own ON public.event_checkout_queue_sessions;
CREATE POLICY event_checkout_queue_select_own
  ON public.event_checkout_queue_sessions
  FOR SELECT
  TO authenticated
  USING (client_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.event_high_traffic_enabled(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT e.checkout_queue_enabled
         OR e.checkout_async_webhook
         OR e.inventory_mode = 'counter'
      FROM public.events e
      WHERE e.id = p_event_id
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.invalidate_event_availability_cache(p_event_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.event_availability_cache WHERE event_id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION public.get_event_ticket_availability(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
        'batch_active', (v_today BETWEEN eb.start_date AND eb.end_date)
      ) AS row_payload,
      eb.price AS sort_price,
      eb.name AS sort_name
      FROM public.event_batches eb
      INNER JOIN public.batch_inventory bi ON bi.batch_id = eb.id
      WHERE eb.event_id = p_event_id
        AND eb.price > 0
        AND eb.wristband_id IS NOT NULL
        AND v_today BETWEEN eb.start_date AND eb.end_date
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
        'batch_active', true
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

CREATE OR REPLACE FUNCTION public.check_checkout_rate_limit(
  p_event_id UUID,
  p_client_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_window TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF p_event_id IS NULL OR p_client_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  SELECT e.checkout_rate_limit_per_minute
  INTO v_limit
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND OR v_limit IS NULL OR v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  v_window := date_trunc('minute', timezone('utc'::text, now()));

  INSERT INTO public.checkout_rate_limit_buckets (event_id, client_user_id, window_minute, request_count)
  VALUES (p_event_id, p_client_user_id, v_window, 1)
  ON CONFLICT (event_id, client_user_id, window_minute) DO UPDATE
  SET request_count = checkout_rate_limit_buckets.request_count + 1
  RETURNING request_count INTO v_count;

  IF v_count > v_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Muitas tentativas de compra. Aguarde um minuto e tente novamente.',
      'retry_after_seconds', 60
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'count', v_count, 'limit', v_limit);
END;
$$;

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

  IF FOUND THEN
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

    SELECT COUNT(*)::INTEGER + 1
    INTO v_position
    FROM public.event_checkout_queue_sessions q
    WHERE q.event_id = p_event_id
      AND q.status = 'waiting'
      AND q.created_at < v_existing.created_at;

    RETURN jsonb_build_object(
      'ok', true,
      'queue_enabled', true,
      'status', 'waiting',
      'session_token', v_existing.session_token,
      'position', v_position,
      'wait_estimate_seconds', GREATEST(
        1,
        CEIL(v_position::numeric / GREATEST(v_admit_rate, 1)::numeric * 60)::INTEGER
      )
    );
  END IF;

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

  RETURN jsonb_build_object(
    'ok', true,
    'queue_enabled', true,
    'status', 'waiting',
    'session_token', v_token,
    'position', v_position,
    'wait_estimate_seconds', GREATEST(
      1,
      CEIL(v_position::numeric / GREATEST(v_admit_rate, 1)::numeric * 60)::INTEGER
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.poll_event_checkout_queue(p_session_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_checkout_queue_sessions%ROWTYPE;
  v_position INTEGER;
  v_admit_rate INTEGER;
BEGIN
  SELECT *
  INTO v_row
  FROM public.event_checkout_queue_sessions q
  WHERE q.session_token = NULLIF(trim(p_session_token), '');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_row.status = 'expired'
     OR (v_row.expires_at IS NOT NULL AND v_row.expires_at <= timezone('utc'::text, now())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_expired', 'status', 'expired');
  END IF;

  IF v_row.status = 'admitted' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'admitted',
      'session_token', v_row.session_token,
      'position', 0,
      'wait_estimate_seconds', 0,
      'expires_at', v_row.expires_at
    );
  END IF;

  SELECT e.checkout_admit_per_minute
  INTO v_admit_rate
  FROM public.events e
  WHERE e.id = v_row.event_id;

  SELECT COUNT(*)::INTEGER
  INTO v_position
  FROM public.event_checkout_queue_sessions q
  WHERE q.event_id = v_row.event_id
    AND q.status = 'waiting'
    AND q.created_at <= v_row.created_at;

  RETURN jsonb_build_object(
    'ok', true,
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

CREATE OR REPLACE FUNCTION public.validate_event_checkout_queue(
  p_session_token TEXT,
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
  v_row public.event_checkout_queue_sessions%ROWTYPE;
BEGIN
  SELECT e.checkout_queue_enabled
  INTO v_enabled
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  IF NULLIF(trim(p_session_token), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe o token da fila de checkout.');
  END IF;

  SELECT *
  INTO v_row
  FROM public.event_checkout_queue_sessions q
  WHERE q.session_token = trim(p_session_token)
    AND q.event_id = p_event_id
    AND q.client_user_id = p_client_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão da fila inválida.');
  END IF;

  IF v_row.status <> 'admitted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Aguarde sua vez na fila para comprar.');
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= timezone('utc'::text, now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sua sessão de compra expirou. Entre na fila novamente.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'session_id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_event_checkout_queue(
  p_session_token TEXT,
  p_event_id UUID,
  p_client_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE public.event_checkout_queue_sessions q
  SET
    status = 'consumed',
    consumed_at = timezone('utc'::text, now())
  WHERE q.session_token = NULLIF(trim(p_session_token), '')
    AND q.event_id = p_event_id
    AND q.client_user_id = p_client_user_id
    AND q.status = 'admitted';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('ok', v_rows > 0, 'consumed', v_rows > 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.admit_event_checkout_queue_batch(
  p_event_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_limit INTEGER;
  v_admit INTEGER;
  v_total_admitted INTEGER := 0;
  v_row RECORD;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));

  FOR v_event IN
    SELECT e.id, e.checkout_admit_per_minute
    FROM public.events e
    WHERE e.checkout_queue_enabled IS TRUE
      AND (p_event_id IS NULL OR e.id = p_event_id)
  LOOP
    v_admit := GREATEST(1, LEAST(v_limit, COALESCE(v_event.checkout_admit_per_minute, 120)));

    FOR v_row IN
      SELECT q.id
      FROM public.event_checkout_queue_sessions q
      WHERE q.event_id = v_event.id
        AND q.status = 'waiting'
      ORDER BY q.created_at ASC
      LIMIT v_admit
    LOOP
      UPDATE public.event_checkout_queue_sessions q
      SET
        status = 'admitted',
        admitted_at = timezone('utc'::text, now()),
        expires_at = timezone('utc'::text, now()) + interval '10 minutes',
        queue_position = 0
      WHERE q.id = v_row.id
        AND q.status = 'waiting';

      IF FOUND THEN
        v_total_admitted := v_total_admitted + 1;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.event_checkout_queue_sessions q
  SET status = 'expired'
  WHERE q.status IN ('waiting', 'admitted')
    AND q.expires_at IS NOT NULL
    AND q.expires_at <= timezone('utc'::text, now());

  RETURN jsonb_build_object('ok', true, 'admitted', v_total_admitted);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_payment_webhook_job(
  p_mp_payment_id TEXT,
  p_external_reference TEXT,
  p_event_id UUID,
  p_payment_status TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_status TEXT;
BEGIN
  INSERT INTO public.payment_webhook_jobs (
    mp_payment_id,
    external_reference,
    event_id,
    payment_status,
    payload,
    status
  ) VALUES (
    trim(p_mp_payment_id),
    NULLIF(trim(p_external_reference), ''),
    p_event_id,
    NULLIF(trim(p_payment_status), ''),
    p_payload,
    'pending'
  )
  ON CONFLICT (mp_payment_id) DO UPDATE
  SET
    payment_status = EXCLUDED.payment_status,
    payload = EXCLUDED.payload,
    event_id = COALESCE(EXCLUDED.event_id, payment_webhook_jobs.event_id),
    status = CASE
      WHEN payment_webhook_jobs.status = 'completed' THEN payment_webhook_jobs.status
      ELSE 'pending'
    END,
    last_error = NULL
  RETURNING id, status INTO v_id, v_status;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_id,
    'status', v_status,
    'already_completed', v_status = 'completed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_payment_webhook_jobs(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.payment_webhook_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.payment_webhook_jobs j
    WHERE j.status IN ('pending', 'failed')
      AND j.attempts < 8
      AND (j.locked_at IS NULL OR j.locked_at < timezone('utc'::text, now()) - interval '2 minutes')
    ORDER BY j.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.payment_webhook_jobs j
  SET
    status = 'processing',
    locked_at = timezone('utc'::text, now()),
    attempts = j.attempts + 1
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_payment_webhook_job(
  p_job_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payment_webhook_jobs j
  SET
    status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    processed_at = CASE WHEN p_success THEN timezone('utc'::text, now()) ELSE j.processed_at END,
    last_error = CASE WHEN p_success THEN NULL ELSE LEFT(COALESCE(p_error, 'unknown'), 500) END,
    locked_at = NULL
  WHERE j.id = p_job_id;
END;
$$;

-- Integrar rate limit, fila e invalidação de cache na reserva existente
CREATE OR REPLACE FUNCTION public.reserve_tickets_for_mp_checkout(
  p_client_user_id UUID,
  p_manager_user_id UUID,
  p_event_id UUID,
  p_total_value NUMERIC,
  p_items JSONB,
  p_idempotency_key TEXT DEFAULT NULL,
  p_queue_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate JSONB;
  v_queue JSONB;
  v_transaction_id UUID;
  v_analytics_ids UUID[] := '{}'::uuid[];
  v_counter_items JSONB := '[]'::jsonb;
  v_i INTEGER;
  v_elem JSONB;
  v_wristband_id UUID;
  v_batch_id UUID;
  v_qty INTEGER;
  v_unit_price NUMERIC;
  v_name TEXT;
  v_reserved UUID[];
  v_reserved_count INTEGER;
  v_existing public.receivables%ROWTYPE;
  v_use_counter BOOLEAN;
  v_today DATE := CURRENT_DATE;
  v_available INTEGER;
  v_rows INTEGER;
BEGIN
  IF p_client_user_id IS NULL OR p_manager_user_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros obrigatórios ausentes.';
  END IF;

  v_rate := public.check_checkout_rate_limit(p_event_id, p_client_user_id);
  IF COALESCE((v_rate->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_rate->>'error', 'Limite de tentativas excedido.');
  END IF;

  v_queue := public.validate_event_checkout_queue(
    p_queue_session_token,
    p_event_id,
    p_client_user_id
  );
  IF COALESCE((v_queue->>'ok')::boolean, false) IS NOT TRUE
     AND COALESCE((v_queue->>'skipped')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_queue->>'error', 'Fila de checkout inválida.');
  END IF;

  v_use_counter := public.event_uses_counter_inventory(p_event_id);

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT *
    INTO v_existing
    FROM public.receivables r
    WHERE r.checkout_idempotency_key = trim(p_idempotency_key)
      AND r.client_user_id = p_client_user_id
    LIMIT 1;

    IF FOUND AND v_existing.status = 'pending' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'inventory_mode', CASE WHEN v_use_counter THEN 'counter' ELSE 'unit_rows' END,
        'transaction_id', v_existing.id,
        'analytics_ids', to_jsonb(COALESCE(v_existing.wristband_analytics_ids, ARRAY[]::uuid[])),
        'counter_reservation_items', COALESCE(v_existing.counter_reservation_items, '[]'::jsonb)
      );
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id AND COALESCE(e.is_active, true) IS TRUE
  ) THEN
    RAISE EXCEPTION 'Este evento não está disponível para novas compras.';
  END IF;

  IF NOT public.event_accepts_new_sales(p_event_id) THEN
    RAISE EXCEPTION 'O prazo para compra de ingressos deste evento foi encerrado.';
  END IF;

  IF NOT public.event_allows_ticket_sales(p_event_id) THEN
    RAISE EXCEPTION 'A venda de ingressos pela plataforma não está disponível para este evento.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum item informado para a compra.';
  END IF;

  IF p_total_value IS NULL OR p_total_value <= 0 THEN
    RAISE EXCEPTION 'Valor total inválido.';
  END IF;

  IF v_use_counter THEN
    FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
      v_elem := p_items->v_i;
      v_wristband_id := COALESCE(
        NULLIF(trim(v_elem->>'wristband_id'), '')::uuid,
        NULLIF(trim(v_elem->>'ticketTypeId'), '')::uuid
      );
      v_qty := (v_elem->>'quantity')::integer;
      v_unit_price := COALESCE((v_elem->>'unit_price')::numeric, (v_elem->>'price')::numeric);
      v_name := COALESCE(NULLIF(trim(v_elem->>'name'), ''), 'Ingresso');

      IF v_wristband_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Item de compra inválido.';
      END IF;

      SELECT eb.id
      INTO v_batch_id
      FROM public.event_batches eb
      WHERE eb.event_id = p_event_id
        AND eb.wristband_id = v_wristband_id
      LIMIT 1;

      IF v_batch_id IS NULL THEN
        RAISE EXCEPTION 'Lote inválido para "%".', v_name;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_batches eb
        WHERE eb.id = v_batch_id
          AND v_today BETWEEN eb.start_date AND eb.end_date
      ) THEN
        RAISE EXCEPTION 'O lote "%" não está disponível para venda nesta data.', v_name;
      END IF;

      PERFORM 1
      FROM public.batch_inventory bi
      WHERE bi.batch_id = v_batch_id
      FOR UPDATE;

      v_available := public.batch_inventory_available(v_batch_id);
      IF v_available < v_qty THEN
        RAISE EXCEPTION 'Ingressos esgotados para "%". Tente novamente.', v_name;
      END IF;

      UPDATE public.batch_inventory bi
      SET
        reserved = bi.reserved + v_qty,
        updated_at = timezone('utc'::text, now())
      WHERE bi.batch_id = v_batch_id
        AND (bi.total - bi.sold - bi.reserved) >= v_qty;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'Ingressos esgotados para "%". Tente novamente.', v_name;
      END IF;

      v_counter_items := v_counter_items || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch_id,
        'wristband_id', v_wristband_id,
        'quantity', v_qty,
        'unit_price', v_unit_price,
        'name', v_name
      ));
    END LOOP;

    INSERT INTO public.receivables (
      client_user_id, manager_user_id, event_id, total_value, status, payment_status,
      gross_amount, wristband_analytics_ids, counter_reservation_items, checkout_idempotency_key
    ) VALUES (
      p_client_user_id, p_manager_user_id, p_event_id, p_total_value, 'pending', 'pending',
      p_total_value, ARRAY[]::uuid[], v_counter_items, NULLIF(trim(p_idempotency_key), '')
    )
    RETURNING id INTO v_transaction_id;

    PERFORM public.invalidate_event_availability_cache(p_event_id);
    PERFORM public.consume_event_checkout_queue(p_queue_session_token, p_event_id, p_client_user_id);

    RETURN jsonb_build_object(
      'ok', true, 'duplicate', false, 'inventory_mode', 'counter',
      'transaction_id', v_transaction_id, 'analytics_ids', '[]'::jsonb,
      'counter_reservation_items', v_counter_items
    );
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_wristband_id := COALESCE(
      NULLIF(trim(v_elem->>'wristband_id'), '')::uuid,
      NULLIF(trim(v_elem->>'ticketTypeId'), '')::uuid
    );
    v_qty := (v_elem->>'quantity')::integer;
    v_name := COALESCE(NULLIF(trim(v_elem->>'name'), ''), 'Ingresso');

    IF v_wristband_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item de compra inválido.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.wristbands w
      WHERE w.id = v_wristband_id AND w.event_id = p_event_id
    ) THEN
      RAISE EXCEPTION 'Tipo de ingresso inválido para este evento.';
    END IF;

    SELECT array_agg(sub.id ORDER BY sub.id)
    INTO v_reserved
    FROM (
      SELECT wa.id
      FROM public.wristband_analytics wa
      WHERE wa.wristband_id = v_wristband_id
        AND wa.status = 'active'
        AND wa.client_user_id IS NULL
      ORDER BY wa.id
      LIMIT v_qty
      FOR UPDATE SKIP LOCKED
    ) sub;

    IF COALESCE(array_length(v_reserved, 1), 0) < v_qty THEN
      RAISE EXCEPTION 'Ingressos esgotados para "%". Tente novamente.', v_name;
    END IF;

    v_analytics_ids := v_analytics_ids || v_reserved;
  END LOOP;

  INSERT INTO public.receivables (
    client_user_id, manager_user_id, event_id, total_value, status, payment_status,
    gross_amount, wristband_analytics_ids, counter_reservation_items, checkout_idempotency_key
  ) VALUES (
    p_client_user_id, p_manager_user_id, p_event_id, p_total_value, 'pending', 'pending',
    p_total_value, v_analytics_ids, NULL, NULLIF(trim(p_idempotency_key), '')
  )
  RETURNING id INTO v_transaction_id;

  UPDATE public.wristband_analytics wa
  SET
    status = 'pending',
    event_type = 'checkout_pending',
    event_data = COALESCE(wa.event_data, '{}'::jsonb) || jsonb_build_object(
      'reserved_transaction_id', v_transaction_id,
      'reserved_at', timezone('utc'::text, now())
    )
  WHERE wa.id = ANY (v_analytics_ids)
    AND wa.status = 'active'
    AND wa.client_user_id IS NULL;

  GET DIAGNOSTICS v_reserved_count = ROW_COUNT;
  IF v_reserved_count <> COALESCE(array_length(v_analytics_ids, 1), 0) THEN
    RAISE EXCEPTION 'Não foi possível reservar os ingressos. Tente novamente.';
  END IF;

  PERFORM public.invalidate_event_availability_cache(p_event_id);
  PERFORM public.consume_event_checkout_queue(p_queue_session_token, p_event_id, p_client_user_id);

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'inventory_mode', 'unit_rows',
    'transaction_id', v_transaction_id, 'analytics_ids', to_jsonb(v_analytics_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ticket_checkout_reservation(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
  v_counter_items JSONB;
  v_event_id UUID;
  v_released INTEGER := 0;
  v_counter_released INTEGER := 0;
  v_reason TEXT := COALESCE(NULLIF(trim(p_reason), ''), 'released');
BEGIN
  IF p_transaction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transaction_id_required');
  END IF;

  SELECT
    COALESCE(r.wristband_analytics_ids, ARRAY[]::uuid[]),
    r.counter_reservation_items,
    r.event_id
  INTO v_ids, v_counter_items, v_event_id
  FROM public.receivables r
  WHERE r.id = p_transaction_id;

  IF COALESCE(array_length(v_ids, 1), 0) > 0 THEN
    UPDATE public.wristband_analytics wa
    SET
      status = 'active',
      event_type = 'inventory',
      event_data = COALESCE(wa.event_data, '{}'::jsonb) || jsonb_build_object(
        'reservation_released_at', timezone('utc'::text, now()),
        'reservation_release_reason', v_reason,
        'transaction_id', p_transaction_id
      )
    WHERE wa.id = ANY (v_ids)
      AND wa.status = 'pending'
      AND wa.client_user_id IS NULL;

    GET DIAGNOSTICS v_released = ROW_COUNT;
  END IF;

  IF v_counter_items IS NOT NULL AND jsonb_array_length(v_counter_items) > 0 THEN
    v_counter_released := public.release_counter_reservation_items(v_counter_items, v_reason);
  END IF;

  UPDATE public.receivables r
  SET
    status = 'failed',
    payment_status = 'cancelled',
    mp_status_detail = v_reason
  WHERE r.id = p_transaction_id
    AND r.status = 'pending';

  IF v_event_id IS NOT NULL THEN
    PERFORM public.invalidate_event_availability_cache(v_event_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', p_transaction_id,
    'released', v_released,
    'counter_released', v_counter_released
  );
END;
$$;

DROP FUNCTION IF EXISTS public.reserve_tickets_for_mp_checkout(UUID, UUID, UUID, NUMERIC, JSONB, TEXT);

GRANT EXECUTE ON FUNCTION public.reserve_tickets_for_mp_checkout(UUID, UUID, UUID, NUMERIC, JSONB, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.event_high_traffic_enabled(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_event_checkout_queue(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.poll_event_checkout_queue(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_event_checkout_queue(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_event_checkout_queue(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_event_checkout_queue_batch(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_checkout_rate_limit(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_payment_webhook_job(TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_payment_webhook_jobs(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_payment_webhook_job(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invalidate_event_availability_cache(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_high_traffic_enabled(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.join_event_checkout_queue(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.poll_event_checkout_queue(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.validate_event_checkout_queue(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_event_checkout_queue(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admit_event_checkout_queue_batch(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_checkout_rate_limit(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_payment_webhook_job(TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payment_webhook_jobs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_payment_webhook_job(UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_event_availability_cache(UUID) TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'event_checkout_queue_admit';

      PERFORM cron.schedule(
        'event_checkout_queue_admit',
        '* * * * *',
        $cmd$SELECT public.admit_event_checkout_queue_batch(NULL, 200)$cmd$
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron event_checkout_queue_admit: %', SQLERRM;
    END;
  END IF;
END;
$cron$;
