-- Fase 2 grande porte: estoque por contador (batch_inventory) + materialização tardia de ingressos.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'unit_rows'
    CHECK (inventory_mode IN ('unit_rows', 'counter'));

COMMENT ON COLUMN public.events.inventory_mode IS
  'unit_rows = 1 linha por ingresso em wristband_analytics; counter = estoque por lote (batch_inventory).';

ALTER TABLE public.event_batches
  ADD COLUMN IF NOT EXISTS wristband_id UUID REFERENCES public.wristbands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_batches_wristband_id
  ON public.event_batches (wristband_id)
  WHERE wristband_id IS NOT NULL;

ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS counter_reservation_items JSONB;

COMMENT ON COLUMN public.receivables.counter_reservation_items IS
  'Reserva por lote (modo counter): [{batch_id, wristband_id, quantity, unit_price, name}].';

CREATE TABLE IF NOT EXISTS public.batch_inventory (
  batch_id UUID PRIMARY KEY REFERENCES public.event_batches(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  total INTEGER NOT NULL CHECK (total >= 0),
  sold INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT batch_inventory_capacity_check CHECK (sold + reserved <= total)
);

CREATE INDEX IF NOT EXISTS idx_batch_inventory_event_id
  ON public.batch_inventory (event_id);

ALTER TABLE public.batch_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batch_inventory_select_public ON public.batch_inventory;
CREATE POLICY batch_inventory_select_public
  ON public.batch_inventory
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE OR REPLACE FUNCTION public.event_uses_counter_inventory(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT e.inventory_mode = 'counter' FROM public.events e WHERE e.id = p_event_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.batch_inventory_available(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(bi.total - bi.sold - bi.reserved, 0)::INTEGER
  FROM public.batch_inventory bi
  WHERE bi.batch_id = p_batch_id;
$$;

CREATE OR REPLACE FUNCTION public.event_active_wristband_count(p_event_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.event_uses_counter_inventory(p_event_id) THEN
    RETURN COALESCE(
      (SELECT SUM(bi.total)::INTEGER FROM public.batch_inventory bi WHERE bi.event_id = p_event_id),
      0
    );
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

CREATE OR REPLACE FUNCTION public.sync_event_batch_counter_assets(p_batch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.event_batches%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_wristband_id UUID;
  v_code TEXT;
  v_manager UUID;
  v_sold INTEGER;
  v_reserved INTEGER;
BEGIN
  SELECT * INTO v_batch FROM public.event_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_batch.event_id;
  IF NOT FOUND OR v_event.inventory_mode <> 'counter' THEN
    RETURN;
  END IF;

  v_manager := v_event.created_by;
  IF v_manager IS NULL AND v_event.company_id IS NOT NULL THEN
    SELECT uc.user_id INTO v_manager
    FROM public.user_companies uc
    WHERE uc.company_id = v_event.company_id
    LIMIT 1;
  END IF;

  v_code := 'B' || upper(replace(left(v_batch.id::text, 8), '-', ''));

  IF v_batch.wristband_id IS NOT NULL THEN
    UPDATE public.wristbands w
    SET
      access_type = v_batch.name,
      price = v_batch.price,
      status = 'active'
    WHERE w.id = v_batch.wristband_id;

    v_wristband_id := v_batch.wristband_id;
  ELSE
    INSERT INTO public.wristbands (
      event_id,
      company_id,
      manager_user_id,
      code,
      access_type,
      status,
      price
    ) VALUES (
      v_batch.event_id,
      v_event.company_id,
      v_manager,
      v_code,
      v_batch.name,
      'active',
      v_batch.price
    )
    RETURNING id INTO v_wristband_id;

    UPDATE public.event_batches
    SET wristband_id = v_wristband_id
    WHERE id = p_batch_id;
  END IF;

  SELECT COALESCE(bi.sold, 0), COALESCE(bi.reserved, 0)
  INTO v_sold, v_reserved
  FROM public.batch_inventory bi
  WHERE bi.batch_id = p_batch_id;

  v_sold := COALESCE(v_sold, 0);
  v_reserved := COALESCE(v_reserved, 0);

  IF v_batch.quantity < v_sold + v_reserved THEN
    RAISE EXCEPTION
      'Quantidade do lote (%) menor que vendido/reservado (%).',
      v_batch.quantity, v_sold + v_reserved;
  END IF;

  INSERT INTO public.batch_inventory (batch_id, event_id, total, sold, reserved)
  VALUES (p_batch_id, v_batch.event_id, v_batch.quantity, v_sold, v_reserved)
  ON CONFLICT (batch_id) DO UPDATE
  SET
    total = EXCLUDED.total,
    event_id = EXCLUDED.event_id,
    updated_at = timezone('utc'::text, now());
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_event_batch_counter_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.batch_inventory WHERE batch_id = OLD.id;
    RETURN OLD;
  END IF;

  IF public.event_uses_counter_inventory(COALESCE(NEW.event_id, OLD.event_id)) THEN
    PERFORM public.sync_event_batch_counter_assets(COALESCE(NEW.id, OLD.id));
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_event_batch_counter_assets ON public.event_batches;
CREATE TRIGGER trg_sync_event_batch_counter_assets
  AFTER INSERT OR UPDATE OF quantity, price, name, event_id
  ON public.event_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_event_batch_counter_assets();

CREATE OR REPLACE FUNCTION public.backfill_event_counter_inventory(p_event_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_count INTEGER := 0;
BEGIN
  IF NOT public.event_uses_counter_inventory(p_event_id) THEN
    RETURN 0;
  END IF;

  FOR v_batch IN
    SELECT id FROM public.event_batches WHERE event_id = p_event_id
  LOOP
    PERFORM public.sync_event_batch_counter_assets(v_batch.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_events_counter_inventory_backfill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.inventory_mode = 'counter'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.inventory_mode, 'unit_rows') <> 'counter') THEN
    PERFORM public.backfill_event_counter_inventory(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_counter_inventory_backfill ON public.events;
CREATE TRIGGER trg_events_counter_inventory_backfill
  AFTER INSERT OR UPDATE OF inventory_mode
  ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_events_counter_inventory_backfill();

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
BEGIN
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

  RETURN jsonb_build_object(
    'ok', true,
    'inventory_mode', v_mode,
    'ticket_types', v_types
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_counter_reservation_items(
  p_items JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i INTEGER;
  v_elem JSONB;
  v_batch_id UUID;
  v_qty INTEGER;
  v_released INTEGER := 0;
  v_rows INTEGER;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
    v_elem := p_items->v_i;
    v_batch_id := NULLIF(trim(v_elem->>'batch_id'), '')::uuid;
    v_qty := (v_elem->>'quantity')::integer;

    IF v_batch_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.batch_inventory bi
    SET
      reserved = GREATEST(bi.reserved - v_qty, 0),
      updated_at = timezone('utc'::text, now())
    WHERE bi.batch_id = v_batch_id
      AND bi.reserved >= v_qty;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_released := v_released + v_qty;
    END IF;
  END LOOP;

  RETURN v_released;
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_counter_checkout_tickets(
  p_transaction_id UUID,
  p_client_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.receivables%ROWTYPE;
  v_items JSONB;
  v_i INTEGER;
  v_elem JSONB;
  v_batch_id UUID;
  v_wristband_id UUID;
  v_qty INTEGER;
  v_name TEXT;
  v_wristband public.wristbands%ROWTYPE;
  v_client UUID;
  v_analytics_ids UUID[] := '{}'::uuid[];
  v_new_ids UUID[] := '{}'::uuid[];
  v_seq INTEGER;
  v_code TEXT;
  v_j INTEGER;
  v_new_id UUID;
  v_rows INTEGER;
BEGIN
  SELECT * INTO v_r FROM public.receivables WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.';
  END IF;

  v_client := COALESCE(p_client_user_id, v_r.client_user_id);
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Cliente não informado para materialização.';
  END IF;

  IF COALESCE(array_length(v_r.wristband_analytics_ids, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_materialized', true,
      'analytics_ids', to_jsonb(v_r.wristband_analytics_ids)
    );
  END IF;

  v_items := v_r.counter_reservation_items;
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_counter_items');
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_elem := v_items->v_i;
    v_batch_id := NULLIF(trim(v_elem->>'batch_id'), '')::uuid;
    v_wristband_id := NULLIF(trim(v_elem->>'wristband_id'), '')::uuid;
    v_qty := (v_elem->>'quantity')::integer;
    v_name := COALESCE(NULLIF(trim(v_elem->>'name'), ''), 'Ingresso');

    IF v_batch_id IS NULL OR v_wristband_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item de reserva inválido na transação.';
    END IF;

    UPDATE public.batch_inventory bi
    SET
      reserved = bi.reserved - v_qty,
      sold = bi.sold + v_qty,
      updated_at = timezone('utc'::text, now())
    WHERE bi.batch_id = v_batch_id
      AND bi.reserved >= v_qty
      AND (bi.total - bi.sold - bi.reserved) >= 0;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Falha ao confirmar estoque do lote "%".', v_name;
    END IF;

    SELECT * INTO v_wristband FROM public.wristbands WHERE id = v_wristband_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pulseira do lote não encontrada.';
    END IF;

    SELECT COALESCE(MAX(wa.sequential_number), 0)
    INTO v_seq
    FROM public.wristband_analytics wa
    WHERE wa.wristband_id = v_wristband_id;

    FOR v_j IN 1 .. v_qty LOOP
      v_seq := v_seq + 1;
      v_code := v_wristband.code || '-' || lpad(v_seq::text, 6, '0');

      INSERT INTO public.wristband_analytics (
        wristband_id,
        event_type,
        client_user_id,
        code_wristbands,
        status,
        sequential_number,
        event_data
      ) VALUES (
        v_wristband_id,
        'purchase',
        v_client,
        v_code,
        'active',
        v_seq,
        jsonb_build_object(
          'code', v_code,
          'access_type', v_wristband.access_type,
          'price', v_wristband.price,
          'event_id', v_wristband.event_id,
          'transaction_id', p_transaction_id,
          'batch_id', v_batch_id,
          'materialized_at', timezone('utc'::text, now())
        )
      )
      RETURNING id INTO v_new_id;

      v_new_ids := v_new_ids || v_new_id;
    END LOOP;
  END LOOP;

  v_analytics_ids := v_new_ids;

  UPDATE public.receivables r
  SET wristband_analytics_ids = v_analytics_ids
  WHERE r.id = p_transaction_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_materialized', false,
    'analytics_ids', to_jsonb(v_analytics_ids),
    'materialized_count', COALESCE(array_length(v_analytics_ids, 1), 0)
  );
END;
$$;

-- Reserva checkout: ramificação counter vs unit_rows
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
      client_user_id,
      manager_user_id,
      event_id,
      total_value,
      status,
      payment_status,
      gross_amount,
      wristband_analytics_ids,
      counter_reservation_items,
      checkout_idempotency_key
    ) VALUES (
      p_client_user_id,
      p_manager_user_id,
      p_event_id,
      p_total_value,
      'pending',
      'pending',
      p_total_value,
      ARRAY[]::uuid[],
      v_counter_items,
      NULLIF(trim(p_idempotency_key), '')
    )
    RETURNING id INTO v_transaction_id;

    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'inventory_mode', 'counter',
      'transaction_id', v_transaction_id,
      'analytics_ids', '[]'::jsonb,
      'counter_reservation_items', v_counter_items
    );
  END IF;

  -- Modo legado: unit_rows
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
    counter_reservation_items,
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
    NULL,
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
    'inventory_mode', 'unit_rows',
    'transaction_id', v_transaction_id,
    'analytics_ids', to_jsonb(v_analytics_ids)
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
  v_released INTEGER := 0;
  v_counter_released INTEGER := 0;
  v_reason TEXT := COALESCE(NULLIF(trim(p_reason), ''), 'released');
BEGIN
  IF p_transaction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transaction_id_required');
  END IF;

  SELECT
    COALESCE(r.wristband_analytics_ids, ARRAY[]::uuid[]),
    r.counter_reservation_items
  INTO v_ids, v_counter_items
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

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', p_transaction_id,
    'released', v_released,
    'counter_released', v_counter_released
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_min_event_ticket_analytics_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_company_id UUID;
  v_min INTEGER;
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  SELECT w.event_id, w.company_id
  INTO v_event_id, v_company_id
  FROM public.wristbands w
  WHERE w.id = NEW.wristband_id;

  IF v_event_id IS NULL OR v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.event_uses_counter_inventory(v_event_id) THEN
    RETURN NEW;
  END IF;

  IF NOT public.company_requires_paid_ticket_event(v_company_id) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(
    (SELECT w2.price FROM public.wristbands w2 WHERE w2.id = NEW.wristband_id),
    0
  ) <= 0 THEN
    RETURN NEW;
  END IF;

  v_min := public.get_company_min_event_tickets(v_company_id);
  v_count := public.event_active_wristband_count(v_event_id);

  IF v_count > 0 AND v_count < v_min THEN
    RAISE EXCEPTION
      'É necessário ter pelo menos % ingressos ativos neste evento. Total atual: %.',
      v_min, v_count;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.event_uses_counter_inventory(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.batch_inventory_available(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_event_batch_counter_assets(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_event_counter_inventory(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_ticket_availability(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_counter_reservation_items(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_counter_checkout_tickets(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_uses_counter_inventory(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.batch_inventory_available(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_ticket_availability(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_event_counter_inventory(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_counter_checkout_tickets(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_event_batch_counter_assets(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_counter_reservation_items(JSONB, TEXT) TO service_role;

COMMENT ON TABLE public.batch_inventory IS
  'Estoque por lote (modo counter): total/sold/reserved; available = total - sold - reserved.';

COMMENT ON FUNCTION public.materialize_counter_checkout_tickets IS
  'Após pagamento MP: gera wristband_analytics, move reserved→sold e preenche wristband_analytics_ids.';
