-- Fase 1 grande porte: reserva atômica no checkout MP, índices e expiração de reservas stale.

-- Índice parcial: consultas de disponibilidade no checkout
CREATE INDEX IF NOT EXISTS idx_wa_availability_checkout
  ON public.wristband_analytics (wristband_id, id)
  WHERE status = 'active' AND client_user_id IS NULL;

-- Índice: job de expiração de checkouts pendentes
CREATE INDEX IF NOT EXISTS idx_receivables_pending_created_at
  ON public.receivables (created_at)
  WHERE status = 'pending';

ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_checkout_idempotency_key
  ON public.receivables (checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

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
  v_released INTEGER;
  v_reason TEXT := COALESCE(NULLIF(trim(p_reason), ''), 'released');
BEGIN
  IF p_transaction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transaction_id_required');
  END IF;

  SELECT COALESCE(r.wristband_analytics_ids, ARRAY[]::uuid[])
  INTO v_ids
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
  ELSE
    v_released := 0;
  END IF;

  UPDATE public.receivables r
  SET
    status = 'failed',
    payment_status = 'cancelled',
    mp_status_detail = v_reason
  WHERE r.id = p_transaction_id
    AND r.status = 'pending';

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', p_transaction_id,
    'released', v_released
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_tickets_for_mp_checkout(
  p_client_user_id UUID,
  p_manager_user_id UUID,
  p_event_id UUID,
  p_total_value NUMERIC,
  p_items JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
  v_analytics_ids UUID[] := '{}'::uuid[];
  v_i INTEGER;
  v_elem JSONB;
  v_wristband_id UUID;
  v_qty INTEGER;
  v_name TEXT;
  v_reserved UUID[];
  v_reserved_count INTEGER;
  v_existing public.receivables%ROWTYPE;
BEGIN
  IF p_client_user_id IS NULL OR p_manager_user_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros obrigatórios ausentes.';
  END IF;

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
        'transaction_id', v_existing.id,
        'analytics_ids', to_jsonb(COALESCE(v_existing.wristband_analytics_ids, ARRAY[]::uuid[]))
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
      SELECT 1
      FROM public.wristbands w
      WHERE w.id = v_wristband_id
        AND w.event_id = p_event_id
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
    client_user_id,
    manager_user_id,
    event_id,
    total_value,
    status,
    payment_status,
    gross_amount,
    wristband_analytics_ids,
    checkout_idempotency_key
  ) VALUES (
    p_client_user_id,
    p_manager_user_id,
    p_event_id,
    p_total_value,
    'pending',
    'pending',
    p_total_value,
    v_analytics_ids,
    NULLIF(trim(p_idempotency_key), '')
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

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'transaction_id', v_transaction_id,
    'analytics_ids', to_jsonb(v_analytics_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_ticket_checkout_reservations(
  p_older_than_minutes INTEGER DEFAULT 15,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_processed INTEGER := 0;
  v_released_total INTEGER := 0;
  v_result JSONB;
  v_cutoff TIMESTAMPTZ;
  v_minutes INTEGER;
  v_batch_limit INTEGER;
BEGIN
  v_minutes := GREATEST(5, LEAST(COALESCE(p_older_than_minutes, 15), 120));
  v_batch_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_cutoff := timezone('utc'::text, now()) - (v_minutes || ' minutes')::interval;

  FOR v_row IN
    SELECT r.id
    FROM public.receivables r
    WHERE r.status = 'pending'
      AND COALESCE(r.payment_status, 'pending') = 'pending'
      AND r.created_at <= v_cutoff
    ORDER BY r.created_at ASC
    LIMIT v_batch_limit
  LOOP
    v_result := public.release_ticket_checkout_reservation(v_row.id, 'checkout_expired');
    v_processed := v_processed + 1;
    v_released_total := v_released_total + COALESCE((v_result->>'released')::integer, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'analytics_released', v_released_total,
    'older_than_minutes', v_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_ticket_checkout_reservation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_tickets_for_mp_checkout(UUID, UUID, UUID, NUMERIC, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_ticket_checkout_reservations(INTEGER, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.release_ticket_checkout_reservation(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_tickets_for_mp_checkout(UUID, UUID, UUID, NUMERIC, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_ticket_checkout_reservations(INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.reserve_tickets_for_mp_checkout IS
  'Reserva ingressos com FOR UPDATE SKIP LOCKED e cria receivable pending em transação única (checkout MP).';

COMMENT ON FUNCTION public.expire_stale_ticket_checkout_reservations IS
  'Libera reservas de checkout MP abandonadas após N minutos (padrão 15).';

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'ticket_checkout_expire_stale';

      PERFORM cron.schedule(
        'ticket_checkout_expire_stale',
        '*/5 * * * *',
        $cmd$SELECT public.expire_stale_ticket_checkout_reservations(15, 100)$cmd$
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron ticket_checkout_expire_stale: %', SQLERRM;
    END;
  END IF;
END;
$cron$;
