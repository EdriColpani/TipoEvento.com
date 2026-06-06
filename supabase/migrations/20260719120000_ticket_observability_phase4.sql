-- Fase 4 grande porte: observabilidade operacional, integridade de estoque e logs estruturados.

CREATE TABLE IF NOT EXISTS public.checkout_ops_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  correlation_id TEXT,
  operation TEXT NOT NULL
    CHECK (operation IN (
      'reserve_ok', 'reserve_conflict', 'reserve_error', 'rate_limited', 'queue_rejected',
      'payment_ok', 'payment_failed', 'webhook_enqueued', 'webhook_processed', 'webhook_failed',
      'reservation_expired', 'inventory_integrity_fail'
    )),
  status TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'warning', 'error')),
  duration_ms INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_checkout_ops_events_event_created
  ON public.checkout_ops_events (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_ops_events_correlation
  ON public.checkout_ops_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_ops_events_operation_created
  ON public.checkout_ops_events (operation, created_at DESC);

ALTER TABLE public.checkout_ops_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkout_ops_events_admin_select ON public.checkout_ops_events;
CREATE POLICY checkout_ops_events_admin_select
  ON public.checkout_ops_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.tipo_usuario_id = 1
    )
  );

COMMENT ON TABLE public.checkout_ops_events IS
  'Log operacional de checkout (reserva, pagamento, webhook) para observabilidade grande porte.';

CREATE OR REPLACE FUNCTION public.is_admin_master()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.tipo_usuario_id = 1
  );
$$;

CREATE OR REPLACE FUNCTION public.log_checkout_ops_event(
  p_event_id UUID,
  p_correlation_id TEXT,
  p_operation TEXT,
  p_status TEXT DEFAULT 'ok',
  p_duration_ms INTEGER DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.checkout_ops_events (
    event_id,
    correlation_id,
    operation,
    status,
    duration_ms,
    details
  )
  VALUES (
    p_event_id,
    NULLIF(trim(p_correlation_id), ''),
    p_operation,
    COALESCE(NULLIF(trim(p_status), ''), 'ok'),
    p_duration_ms,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_checkout_ops_event(UUID, TEXT, TEXT, TEXT, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_checkout_ops_event(UUID, TEXT, TEXT, TEXT, INTEGER, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_event_inventory_integrity(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_use_counter BOOLEAN;
  v_violations JSONB := '[]'::jsonb;
  v_batch RECORD;
  v_pending_wa INTEGER := 0;
  v_active_wa INTEGER := 0;
  v_sold_wa INTEGER := 0;
  v_total_capacity INTEGER := 0;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_id required');
  END IF;

  v_use_counter := public.event_uses_counter_inventory(p_event_id);

  IF v_use_counter THEN
    FOR v_batch IN
      SELECT
        bi.batch_id,
        eb.name AS batch_name,
        bi.total,
        bi.sold,
        bi.reserved,
        (bi.sold + bi.reserved - bi.total) AS over_by
      FROM public.batch_inventory bi
      INNER JOIN public.event_batches eb ON eb.id = bi.batch_id
      WHERE bi.event_id = p_event_id
        AND (bi.sold + bi.reserved > bi.total OR bi.sold < 0 OR bi.reserved < 0)
    LOOP
      v_violations := v_violations || jsonb_build_array(jsonb_build_object(
        'type', 'batch_over_capacity',
        'batch_id', v_batch.batch_id,
        'batch_name', v_batch.batch_name,
        'total', v_batch.total,
        'sold', v_batch.sold,
        'reserved', v_batch.reserved,
        'over_by', v_batch.over_by
      ));
    END LOOP;
  ELSE
    SELECT COUNT(*)::INTEGER
    INTO v_total_capacity
    FROM public.wristband_analytics wa
    INNER JOIN public.wristbands w ON w.id = wa.wristband_id
    WHERE w.event_id = p_event_id
      AND w.status = 'active'
      AND wa.status = 'active';

    SELECT
      COUNT(*) FILTER (WHERE wa.event_type = 'checkout_pending' AND wa.client_user_id IS NULL),
      COUNT(*) FILTER (WHERE wa.client_user_id IS NULL AND wa.event_type <> 'checkout_pending'),
      COUNT(*) FILTER (WHERE wa.client_user_id IS NOT NULL)
    INTO v_pending_wa, v_active_wa, v_sold_wa
    FROM public.wristband_analytics wa
    INNER JOIN public.wristbands w ON w.id = wa.wristband_id
    WHERE w.event_id = p_event_id
      AND w.status = 'active'
      AND wa.status = 'active';

    IF v_pending_wa + v_active_wa + v_sold_wa > v_total_capacity THEN
      v_violations := v_violations || jsonb_build_array(jsonb_build_object(
        'type', 'unit_rows_count_mismatch',
        'total', v_total_capacity,
        'pending', v_pending_wa,
        'available', v_active_wa,
        'sold', v_sold_wa,
        'over_by', (v_pending_wa + v_active_wa + v_sold_wa) - v_total_capacity
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
    'inventory_mode', CASE WHEN v_use_counter THEN 'counter' ELSE 'unit_rows' END,
    'violations', v_violations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_event_inventory_integrity(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_event_inventory_integrity(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_checkout_observability(
  p_event_id UUID DEFAULT NULL,
  p_window_minutes INTEGER DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window INTEGER;
  v_since TIMESTAMPTZ;
  v_event RECORD;
  v_integrity JSONB;
  v_alerts JSONB := '[]'::jsonb;
  v_reservations INTEGER := 0;
  v_payments INTEGER := 0;
  v_pending_receivables INTEGER := 0;
  v_pending_wa INTEGER := 0;
  v_queue_waiting INTEGER := 0;
  v_queue_admitted INTEGER := 0;
  v_webhook_pending INTEGER := 0;
  v_webhook_failed INTEGER := 0;
  v_rate_limited INTEGER := 0;
  v_reserve_errors INTEGER := 0;
  v_reserve_conflicts INTEGER := 0;
  v_total_capacity INTEGER := 0;
  v_sold INTEGER := 0;
  v_reserved INTEGER := 0;
  v_available INTEGER := 0;
  v_cache_age_seconds INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_master() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_window := GREATEST(1, LEAST(COALESCE(p_window_minutes, 15), 1440));
  v_since := timezone('utc'::text, now()) - make_interval(mins => v_window);

  IF p_event_id IS NOT NULL THEN
    SELECT e.id, e.title, e.inventory_mode, e.checkout_queue_enabled, e.checkout_async_webhook
    INTO v_event
    FROM public.events e
    WHERE e.id = p_event_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'event not found';
    END IF;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE r.created_at >= v_since),
    COUNT(*) FILTER (
      WHERE r.created_at >= v_since
        AND COALESCE(r.payment_status, '') IN ('approved', 'authorized')
    ),
    COUNT(*) FILTER (WHERE COALESCE(r.status, '') = 'pending')
  INTO v_reservations, v_payments, v_pending_receivables
  FROM public.receivables r
  WHERE (p_event_id IS NULL OR r.event_id = p_event_id);

  IF p_event_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_pending_wa
    FROM public.wristband_analytics wa
    INNER JOIN public.wristbands w ON w.id = wa.wristband_id
    WHERE w.event_id = p_event_id
      AND wa.event_type = 'checkout_pending'
      AND wa.status = 'active';

    SELECT
      COUNT(*) FILTER (WHERE q.status = 'waiting'),
      COUNT(*) FILTER (WHERE q.status = 'admitted')
    INTO v_queue_waiting, v_queue_admitted
    FROM public.event_checkout_queue_sessions q
    WHERE q.event_id = p_event_id;

    SELECT
      COUNT(*) FILTER (WHERE j.status IN ('pending', 'processing')),
      COUNT(*) FILTER (WHERE j.status = 'failed')
    INTO v_webhook_pending, v_webhook_failed
    FROM public.payment_webhook_jobs j
    WHERE j.event_id = p_event_id;

    IF public.event_uses_counter_inventory(p_event_id) THEN
      SELECT
        COALESCE(SUM(bi.total), 0)::INTEGER,
        COALESCE(SUM(bi.sold), 0)::INTEGER,
        COALESCE(SUM(bi.reserved), 0)::INTEGER,
        COALESCE(SUM(GREATEST(bi.total - bi.sold - bi.reserved, 0)), 0)::INTEGER
      INTO v_total_capacity, v_sold, v_reserved, v_available
      FROM public.batch_inventory bi
      WHERE bi.event_id = p_event_id;
    ELSE
      SELECT public.event_active_wristband_count(p_event_id) INTO v_total_capacity;
      v_available := (
        SELECT COUNT(*)::INTEGER
        FROM public.wristband_analytics wa
        INNER JOIN public.wristbands w ON w.id = wa.wristband_id
        WHERE w.event_id = p_event_id
          AND w.status = 'active'
          AND wa.status = 'active'
          AND wa.client_user_id IS NULL
          AND wa.event_type <> 'checkout_pending'
      );
      v_sold := (
        SELECT COUNT(*)::INTEGER
        FROM public.wristband_analytics wa
        INNER JOIN public.wristbands w ON w.id = wa.wristband_id
        WHERE w.event_id = p_event_id
          AND wa.client_user_id IS NOT NULL
      );
      v_reserved := v_pending_wa;
    END IF;

    v_integrity := public.verify_event_inventory_integrity(p_event_id);

    SELECT EXTRACT(EPOCH FROM (timezone('utc'::text, now()) - c.updated_at))::INTEGER
    INTO v_cache_age_seconds
    FROM public.event_availability_cache c
    WHERE c.event_id = p_event_id;
  ELSE
    v_integrity := jsonb_build_object('ok', true, 'scope', 'global');
    v_cache_age_seconds := NULL;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE o.operation = 'rate_limited' AND o.created_at >= v_since),
    COUNT(*) FILTER (WHERE o.operation = 'reserve_error' AND o.created_at >= v_since),
    COUNT(*) FILTER (WHERE o.operation = 'reserve_conflict' AND o.created_at >= v_since)
  INTO v_rate_limited, v_reserve_errors, v_reserve_conflicts
  FROM public.checkout_ops_events o
  WHERE (p_event_id IS NULL OR o.event_id = p_event_id);

  IF p_event_id IS NOT NULL AND COALESCE((v_integrity->>'ok')::boolean, true) IS NOT TRUE THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'level', 'critical',
      'code', 'inventory_integrity',
      'message', 'Possível overselling detectado — verifique lotes/estoque.'
    ));
  END IF;

  IF v_webhook_pending >= 25 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'level', 'warning',
      'code', 'webhook_backlog',
      'message', format('Fila de webhook com %s jobs pendentes.', v_webhook_pending)
    ));
  END IF;

  IF v_webhook_failed >= 5 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'level', 'warning',
      'code', 'webhook_failures',
      'message', format('%s jobs de webhook falharam.', v_webhook_failed)
    ));
  END IF;

  IF v_pending_receivables >= 100 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'level', 'warning',
      'code', 'pending_checkouts',
      'message', format('%s checkouts pendentes aguardando pagamento.', v_pending_receivables)
    ));
  END IF;

  IF v_queue_waiting >= 500 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'level', 'info',
      'code', 'queue_pressure',
      'message', format('Fila virtual: %s aguardando, %s admitidos.', v_queue_waiting, v_queue_admitted)
    ));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', timezone('utc'::text, now()),
    'window_minutes', v_window,
    'event', CASE
      WHEN p_event_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_event.id,
        'title', v_event.title,
        'inventory_mode', v_event.inventory_mode,
        'checkout_queue_enabled', v_event.checkout_queue_enabled,
        'checkout_async_webhook', v_event.checkout_async_webhook
      )
    END,
    'metrics', jsonb_build_object(
      'reservations_window', v_reservations,
      'reservations_per_minute', ROUND(v_reservations::numeric / v_window, 2),
      'payments_window', v_payments,
      'payments_per_minute', ROUND(v_payments::numeric / v_window, 2),
      'pending_receivables', v_pending_receivables,
      'pending_checkout_tickets', v_pending_wa,
      'queue_waiting', v_queue_waiting,
      'queue_admitted', v_queue_admitted,
      'webhook_jobs_pending', v_webhook_pending,
      'webhook_jobs_failed', v_webhook_failed,
      'rate_limited_window', v_rate_limited,
      'reserve_errors_window', v_reserve_errors,
      'reserve_conflicts_window', v_reserve_conflicts,
      'availability_cache_age_seconds', v_cache_age_seconds
    ),
    'inventory', CASE
      WHEN p_event_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'total_capacity', v_total_capacity,
        'sold', v_sold,
        'reserved', v_reserved,
        'available', v_available,
        'integrity', v_integrity
      )
    END,
    'alerts', v_alerts,
    'recent_events', (
      SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT o.operation, o.status, o.correlation_id, o.duration_ms, o.details, o.created_at
        FROM public.checkout_ops_events o
        WHERE (p_event_id IS NULL OR o.event_id = p_event_id)
        ORDER BY o.created_at DESC
        LIMIT 20
      ) x
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_checkout_observability(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_checkout_observability(UUID, INTEGER) TO authenticated;

-- Retenção: manter 30 dias de logs operacionais.
CREATE OR REPLACE FUNCTION public.purge_old_checkout_ops_events()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.checkout_ops_events
  WHERE created_at < timezone('utc'::text, now()) - interval '30 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_checkout_ops_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_checkout_ops_events() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'checkout_ops_events_purge') THEN
    PERFORM cron.unschedule('checkout_ops_events_purge');
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'checkout_ops_events_purge',
    '15 4 * * *',
    $cron$SELECT public.purge_old_checkout_ops_events();$cron$
  );
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'pg_cron não disponível — purge manual de checkout_ops_events.';
WHEN OTHERS THEN
  RAISE NOTICE 'Não foi possível agendar checkout_ops_events_purge: %', SQLERRM;
END $$;
