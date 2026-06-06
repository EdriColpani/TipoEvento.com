-- Fase 5 grande porte: checklist operacional pré-venda (gestor + admin).

CREATE TABLE IF NOT EXISTS public.event_go_live_acknowledgements (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL
    CHECK (item_key IN (
      'load_test_approved',
      'runbook_acknowledged',
      'soft_open_planned',
      'support_scheduled'
    )),
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  notes TEXT,
  PRIMARY KEY (event_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_event_go_live_ack_event
  ON public.event_go_live_acknowledgements (event_id);

ALTER TABLE public.event_go_live_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_go_live_ack_select ON public.event_go_live_acknowledgements;
CREATE POLICY event_go_live_ack_select
  ON public.event_go_live_acknowledgements
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_master()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_go_live_acknowledgements.event_id
        AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS event_go_live_ack_write ON public.event_go_live_acknowledgements;
CREATE POLICY event_go_live_ack_write
  ON public.event_go_live_acknowledgements
  FOR ALL
  TO authenticated
  USING (
    public.is_admin_master()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_go_live_acknowledgements.event_id
        AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin_master()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_go_live_acknowledgements.event_id
        AND e.created_by = auth.uid()
    )
  );

COMMENT ON TABLE public.event_go_live_acknowledgements IS
  'Confirmações manuais do checklist go-live (mega eventos).';

CREATE OR REPLACE FUNCTION public.user_can_manage_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND (
        public.is_admin_master()
        OR e.created_by = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.set_event_go_live_acknowledgement(
  p_event_id UUID,
  p_item_key TEXT,
  p_acknowledged BOOLEAN,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.user_can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_item_key NOT IN (
    'load_test_approved',
    'runbook_acknowledged',
    'soft_open_planned',
    'support_scheduled'
  ) THEN
    RAISE EXCEPTION 'invalid item_key';
  END IF;

  INSERT INTO public.event_go_live_acknowledgements (
    event_id,
    item_key,
    acknowledged,
    acknowledged_at,
    acknowledged_by,
    notes
  )
  VALUES (
    p_event_id,
    p_item_key,
    COALESCE(p_acknowledged, false),
    CASE WHEN COALESCE(p_acknowledged, false) THEN timezone('utc'::text, now()) ELSE NULL END,
    CASE WHEN COALESCE(p_acknowledged, false) THEN auth.uid() ELSE NULL END,
    NULLIF(trim(p_notes), '')
  )
  ON CONFLICT (event_id, item_key) DO UPDATE SET
    acknowledged = EXCLUDED.acknowledged,
    acknowledged_at = EXCLUDED.acknowledged_at,
    acknowledged_by = EXCLUDED.acknowledged_by,
    notes = EXCLUDED.notes;

  RETURN public.get_event_go_live_checklist(p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_go_live_acknowledgement(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_event_go_live_acknowledgement(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

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
  v_ready_count INTEGER := 0;
  v_required_count INTEGER := 0;
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
    e.is_active
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found';
  END IF;

  IF v_event.inventory_mode IS DISTINCT FROM 'counter'
     AND COALESCE(v_event.checkout_queue_enabled, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'applies', false,
      'event_id', p_event_id,
      'message', 'Checklist go-live aplica-se a eventos de grande porte (contador ou fila virtual).'
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

  -- Auto: modo contador
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'counter_mode',
    'label', 'Evento de grande porte (estoque por contador)',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN v_event.inventory_mode = 'counter' THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN v_event.inventory_mode = 'counter'
      THEN 'Modo contador ativo.'
      ELSE 'Marque "Evento de grande porte" no cadastro do evento.' END
  ));

  -- Auto: lotes e capacidade
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
      WHEN v_batch_rows = 0 THEN 'Nenhum lote com estoque contador. Salve os lotes no evento.'
      WHEN v_batch_total <= 0 THEN 'Capacidade total dos lotes é zero.'
      WHEN v_capacity > 0 AND v_batch_total <> v_capacity THEN
        format('Soma dos lotes (%s) difere da capacidade do evento (%s).', v_batch_total, v_capacity)
      ELSE format('Estoque total: %s ingressos em %s lote(s).', v_batch_total, v_batch_rows)
    END,
    'details', jsonb_build_object(
      'batch_total', v_batch_total,
      'batch_count', v_batch_rows,
      'event_capacity', v_capacity
    )
  ));

  -- Auto: integridade
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

  -- Auto: fila virtual (recomendado, não bloqueia se ausente — warning)
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'queue_enabled',
    'label', 'Fila virtual (picos > 1.000 simultâneos)',
    'kind', 'auto',
    'required', false,
    'status', CASE WHEN COALESCE(v_event.checkout_queue_enabled, false) THEN 'pass' ELSE 'warning' END,
    'message', CASE WHEN COALESCE(v_event.checkout_queue_enabled, false)
      THEN 'Fila virtual ativa.'
      ELSE 'Recomendado para mega eventos — ative "grande porte" no cadastro.' END
  ));

  -- Auto: webhook assíncrono
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'async_webhook',
    'label', 'Webhook assíncrono',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN COALESCE(v_event.checkout_async_webhook, false) THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN COALESCE(v_event.checkout_async_webhook, false)
      THEN 'Processamento de pagamento enfileirado.'
      ELSE 'Ative junto com o modo grande porte.' END
  ));

  -- Auto: Mercado Pago
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'key', 'mp_configured',
    'label', 'Mercado Pago configurado',
    'kind', 'auto',
    'required', true,
    'status', CASE WHEN v_mp_ok THEN 'pass' ELSE 'fail' END,
    'message', CASE WHEN v_mp_ok
      THEN 'Credenciais de pagamento OK.'
      ELSE 'Configure Mercado Pago em Perfil da Empresa → Pagamentos.' END
  ));

  -- Manual acknowledgements
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
          WHEN 'load_test_approved' THEN 'Teste de carga aprovado (k6 / sandbox)'
          WHEN 'runbook_acknowledged' THEN 'Runbook operacional lido (pausar vendas, escalação)'
          WHEN 'soft_open_planned' THEN 'Soft open planejado (equipe interna antes do público)'
          WHEN 'support_scheduled' THEN 'Suporte reforçado nas 2 h iniciais de venda'
        END,
        'kind', 'manual',
        'required', true,
        'status', CASE WHEN v_acknowledged THEN 'pass' ELSE 'pending' END,
        'acknowledged', v_acknowledged,
        'notes', v_ack.notes
      )
    );
  END LOOP;

  SELECT
    COUNT(*) FILTER (WHERE (elem->>'required')::boolean IS TRUE),
    COUNT(*) FILTER (
      WHERE (elem->>'required')::boolean IS TRUE
        AND (elem->>'status') IN ('pass', 'warning')
        AND NOT (
          (elem->>'key') = 'inventory_configured'
          AND (elem->>'status') = 'warning'
        )
    )
  INTO v_required_count, v_ready_count
  FROM jsonb_array_elements(v_items) AS elem;

  RETURN jsonb_build_object(
    'ok', true,
    'applies', true,
    'event_id', p_event_id,
    'event_title', v_event.title,
    'is_active', v_event.is_active,
    'ready', v_ready_count >= v_required_count AND v_required_count > 0,
    'ready_count', v_ready_count,
    'required_count', v_required_count,
    'items', v_items,
    'runbook_path', 'docs/RUNBOOK_GRANDE_PORTE.md',
    'load_test_path', 'load-tests/README.md'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_go_live_checklist(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_go_live_checklist(UUID) TO authenticated;
