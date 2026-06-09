-- Unifica eventos pagos no modo counter (estoque por lote).
-- Remove dependência do flag "grande porte" — 10 ou 150 mil ingressos usam o mesmo fluxo.

-- ---------------------------------------------------------------------------
-- 1. Contagem de ingressos ativos: counter usa batch_inventory.total
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.event_active_wristband_count(p_event_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_batch_total INTEGER;
BEGIN
  SELECT COALESCE(e.inventory_mode, 'unit_rows')
  INTO v_mode
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_mode = 'counter' THEN
    SELECT COALESCE(SUM(bi.total), 0)::INTEGER
    INTO v_batch_total
    FROM public.batch_inventory bi
    WHERE bi.event_id = p_event_id;

    RETURN COALESCE(v_batch_total, 0);
  END IF;

  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM public.wristband_analytics wa
    INNER JOIN public.wristbands w ON w.id = wa.wristband_id
    WHERE w.event_id = p_event_id
      AND w.status = 'active'
      AND wa.status = 'active'
      AND COALESCE(w.price, 0) > 0
  );
END;
$$;

COMMENT ON FUNCTION public.event_active_wristband_count(UUID) IS
  'Ingressos ativos do evento: counter = soma batch_inventory.total; legado unit_rows = analytics.';

-- ---------------------------------------------------------------------------
-- 2. Criar lotes a partir de emissão manual (unit_rows sem event_batches, sem vendas)
-- ---------------------------------------------------------------------------

INSERT INTO public.event_batches (event_id, name, quantity, price, start_date, end_date)
SELECT
  w.event_id,
  w.access_type,
  COUNT(wa.id)::integer,
  w.price,
  COALESCE(e.date, CURRENT_DATE),
  COALESCE(e.date, CURRENT_DATE) + INTERVAL '90 days'
FROM public.wristbands w
INNER JOIN public.events e ON e.id = w.event_id
INNER JOIN public.wristband_analytics wa ON wa.wristband_id = w.id
  AND wa.status = 'active'
  AND wa.client_user_id IS NULL
WHERE COALESCE(e.is_paid, false) = true
  AND COALESCE(e.listing_only, false) = false
  AND COALESCE(e.inventory_mode, 'unit_rows') = 'unit_rows'
  AND NOT EXISTS (SELECT 1 FROM public.event_batches eb WHERE eb.event_id = e.id)
  AND NOT EXISTS (
    SELECT 1
    FROM public.wristband_analytics wa2
    INNER JOIN public.wristbands w2 ON w2.id = wa2.wristband_id
    WHERE w2.event_id = e.id
      AND (
        wa2.client_user_id IS NOT NULL
        OR wa2.status IN ('used', 'checkout_pending')
      )
  )
GROUP BY w.event_id, w.access_type, w.price, e.date
HAVING COUNT(wa.id) > 0;

-- ---------------------------------------------------------------------------
-- 3. Converter eventos pagos para counter + webhook assíncrono
-- ---------------------------------------------------------------------------

UPDATE public.events e
SET
  inventory_mode = 'counter',
  checkout_async_webhook = true,
  checkout_queue_enabled = CASE
    WHEN COALESCE(e.capacity, 0) >= 5000 THEN true
    ELSE COALESCE(e.checkout_queue_enabled, false)
  END
WHERE COALESCE(e.is_paid, false) = true
  AND COALESCE(e.listing_only, false) = false
  AND COALESCE(e.inventory_mode, 'unit_rows') <> 'counter'
  AND EXISTS (SELECT 1 FROM public.event_batches eb WHERE eb.event_id = e.id);

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT e.id
    FROM public.events e
    WHERE e.inventory_mode = 'counter'
      AND COALESCE(e.is_paid, false) = true
      AND COALESCE(e.listing_only, false) = false
  LOOP
    PERFORM public.backfill_event_counter_inventory(r.id);
  END LOOP;
END $$;

-- Ajustar sold nos lotes para eventos que já venderam no modo legado
UPDATE public.batch_inventory bi
SET sold = GREATEST(bi.sold, sub.sold_count)
FROM (
  SELECT
    eb.id AS batch_id,
    COUNT(wa.id)::integer AS sold_count
  FROM public.event_batches eb
  INNER JOIN public.wristbands w
    ON w.event_id = eb.event_id
    AND w.access_type = eb.name
    AND w.price = eb.price
  INNER JOIN public.wristband_analytics wa ON wa.wristband_id = w.id
    AND (
      wa.client_user_id IS NOT NULL
      OR wa.status IN ('used', 'checkout_pending')
    )
  GROUP BY eb.id
) sub
WHERE bi.batch_id = sub.batch_id
  AND sub.sold_count > bi.sold;

UPDATE public.batch_inventory bi
SET total = GREATEST(bi.total, bi.sold + bi.reserved)
WHERE bi.sold + bi.reserved > bi.total;

-- ---------------------------------------------------------------------------
-- 4. Limpar estoque pré-materializado não vendido (formato legado)
-- ---------------------------------------------------------------------------

DELETE FROM public.wristband_analytics wa
USING public.wristbands w, public.events e
WHERE wa.wristband_id = w.id
  AND w.event_id = e.id
  AND e.inventory_mode = 'counter'
  AND COALESCE(e.is_paid, false) = true
  AND wa.client_user_id IS NULL
  AND wa.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.event_batches eb WHERE eb.wristband_id = w.id
  );

SELECT public.cleanup_orphan_counter_wristbands(NULL);

DELETE FROM public.wristbands w
USING public.events e
WHERE w.event_id = e.id
  AND e.inventory_mode = 'counter'
  AND COALESCE(e.is_paid, false) = true
  AND NOT EXISTS (SELECT 1 FROM public.event_batches eb WHERE eb.wristband_id = w.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.wristband_analytics wa
    WHERE wa.wristband_id = w.id
      AND (
        wa.client_user_id IS NOT NULL
        OR wa.status IN ('used', 'checkout_pending')
      )
  );

-- ---------------------------------------------------------------------------
-- 5. Vitrine: somente lotes (counter) — sem ramo unit_rows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_event_ticket_availability(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
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
        'batch_active', true,
        'sales_open', true
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
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'inventory_mode', COALESCE(v_mode, 'counter'),
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

COMMENT ON FUNCTION public.get_event_ticket_availability(UUID) IS
  'Tipos de ingresso para vitrine/checkout. Estoque por lote (counter); janela de vendas respeitada.';

-- ---------------------------------------------------------------------------
-- 6. Checklist go-live: aplica a todo evento pago (não só "grande porte")
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_event_go_live_checklist(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_items JSONB := '[]'::jsonb;
  v_auto_required INTEGER := 0;
  v_auto_ready INTEGER := 0;
  v_manual_total INTEGER := 0;
  v_manual_done INTEGER := 0;
  v_batch_total INTEGER := 0;
  v_capacity INTEGER := 0;
  v_batch_rows INTEGER := 0;
  v_integrity JSONB;
  v_mp_ok BOOLEAN := false;
  v_ack RECORD;
  v_manual_keys TEXT[] := ARRAY[
    'load_test_approved',
    'runbook_acknowledged',
    'soft_open_planned',
    'support_scheduled'
  ];
  v_key TEXT;
  v_acknowledged BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.user_can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    e.id,
    e.title,
    e.capacity,
    e.inventory_mode,
    e.checkout_queue_enabled,
    e.checkout_async_webhook,
    e.created_by,
    e.is_active,
    e.is_paid,
    e.listing_only
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found';
  END IF;

  IF COALESCE(v_event.is_paid, false) IS NOT TRUE
     OR COALESCE(v_event.listing_only, false) IS TRUE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'applies', false,
      'event_id', p_event_id,
      'message', 'Checklist go-live aplica-se a eventos pagos com venda de ingressos.'
    );
  END IF;

  SELECT
    COALESCE(SUM(bi.total), 0)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_batch_total, v_batch_rows
  FROM public.batch_inventory bi
  WHERE bi.event_id = p_event_id;

  v_capacity := COALESCE(v_event.capacity, 0);
  v_integrity := public.verify_event_inventory_integrity(p_event_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.payment_settings ps
    WHERE ps.user_id = v_event.created_by
      AND (
        (ps.api_token_ciphertext IS NOT NULL AND length(ps.api_token_ciphertext) > 0)
        OR COALESCE(ps.mp_connection_source, '') = 'oauth'
      )
  ) INTO v_mp_ok;

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'counter_mode',
    'label', 'Estoque por lote (contador)',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN v_event.inventory_mode = 'counter' THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN v_event.inventory_mode = 'counter'
      THEN 'Modo contador ativo.'
      ELSE 'Salve os lotes do evento para ativar o estoque por contador.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'inventory_configured',
    'label', 'Lotes e estoque configurados',
    'kind', 'auto',
    'required', true,
    'status', CASE
      WHEN v_batch_rows = 0 OR v_batch_total <= 0 THEN 'fail'
      WHEN v_capacity > 0 AND v_batch_total <> v_capacity THEN 'warning'
      ELSE 'pass'
    END,
    'message', CASE
      WHEN v_batch_rows = 0 THEN 'Nenhum lote com estoque. Salve os lotes no evento.'
      WHEN v_batch_total <= 0 THEN 'Capacidade total dos lotes é zero.'
      WHEN v_capacity > 0 AND v_batch_total <> v_capacity THEN
        format('Soma dos lotes (%s) difere da capacidade (%s) — pode ativar, mas confira.', v_batch_total, v_capacity)
      ELSE format('Estoque total: %s ingressos em %s lote(s).', v_batch_total, v_batch_rows)
    END,
    'details', jsonb_build_object(
      'batch_total', v_batch_total,
      'batch_count', v_batch_rows,
      'event_capacity', v_capacity
    )
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'inventory_integrity',
    'label', 'Integridade de estoque (sem overselling)',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN COALESCE((v_integrity->>'ok')::boolean, false) THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN COALESCE((v_integrity->>'ok')::boolean, false)
      THEN 'Estoque consistente.'
      ELSE 'Inconsistência detectada — contate o suporte antes de abrir vendas.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'queue_enabled',
    'label', 'Fila virtual (picos > 5.000 ingressos)',
    'kind', 'auto',
    'required', false,
    'status', CASE WHEN COALESCE(v_event.checkout_queue_enabled, false) THEN 'pass' ELSE 'warning' END,
    'message', CASE WHEN COALESCE(v_event.checkout_queue_enabled, false)
      THEN 'Fila virtual ativa.'
      ELSE 'Recomendado para eventos com 5.000+ ingressos ou pico alto de acessos.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'async_webhook',
    'label', 'Webhook assíncrono',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN COALESCE(v_event.checkout_async_webhook, false) THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN COALESCE(v_event.checkout_async_webhook, false)
      THEN 'Processamento de pagamento enfileirado.'
      ELSE 'Salve o evento novamente para ativar o webhook assíncrono.' END
  ));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'mp_configured',
    'label', 'Mercado Pago configurado',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN v_mp_ok THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN v_mp_ok
      THEN 'Credenciais de pagamento OK.'
      ELSE 'Configure Mercado Pago em Perfil da Empresa → aba Ingressos MP.' END
  ));

  FOREACH v_key IN ARRAY v_manual_keys LOOP
    SELECT a.acknowledged, a.notes
    INTO v_ack
    FROM public.event_go_live_acknowledgements a
    WHERE a.event_id = p_event_id AND a.item_key = v_key;

    v_acknowledged := COALESCE(v_ack.acknowledged, false);

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'key', v_key,
        'label', CASE v_key
          WHEN 'load_test_approved' THEN 'Teste de carga aprovado (k6 / sandbox) — recomendado'
          WHEN 'runbook_acknowledged' THEN 'Runbook operacional lido — recomendado'
          WHEN 'soft_open_planned' THEN 'Soft open planejado — recomendado'
          WHEN 'support_scheduled' THEN 'Suporte reforçado nas 2 h iniciais — recomendado'
        END,
        'kind', 'manual',
        'required', false,
        'status', CASE WHEN v_acknowledged THEN 'pass' ELSE 'pending' END,
        'acknowledged', v_acknowledged,
        'notes', v_ack.notes
      )
    );
  END LOOP;

  SELECT
    COUNT(*) FILTER (
      WHERE (elem->>'kind') = 'auto' AND (elem->>'required')::boolean IS TRUE
    ),
    COUNT(*) FILTER (
      WHERE (elem->>'kind') = 'auto'
        AND (elem->>'required')::boolean IS TRUE
        AND (elem->>'status') = 'pass'
    ),
    COUNT(*) FILTER (WHERE (elem->>'kind') = 'manual'),
    COUNT(*) FILTER (
      WHERE (elem->>'kind') = 'manual' AND (elem->>'status') = 'pass'
    )
  INTO v_auto_required, v_auto_ready, v_manual_total, v_manual_done
  FROM jsonb_array_elements(v_items) AS elem;

  RETURN jsonb_build_object(
    'ok', true,
    'applies', true,
    'event_id', p_event_id,
    'event_title', v_event.title,
    'is_active', v_event.is_active,
    'ready', v_auto_ready >= v_auto_required AND v_auto_required > 0,
    'ready_count', v_auto_ready + v_manual_done,
    'required_count', v_auto_required + v_manual_total,
    'auto_ready', v_auto_ready >= v_auto_required AND v_auto_required > 0,
    'auto_ready_count', v_auto_ready,
    'auto_required_count', v_auto_required,
    'items', v_items,
    'runbook_path', 'docs/RUNBOOK_GRANDE_PORTE.md',
    'load_test_path', 'load-tests/README.md'
  );
END;
$$;
