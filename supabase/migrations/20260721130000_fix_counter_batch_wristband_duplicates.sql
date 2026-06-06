-- Corrige duplicação de pulseiras-template (código B…) em eventos counter:
-- cada save do evento recriava lotes e sync criava nova pulseira sem apagar a anterior.

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
    -- Reutiliza pulseira-template do mesmo tipo (evita duplicata ao recriar lote)
    SELECT w.id INTO v_wristband_id
    FROM public.wristbands w
    WHERE w.event_id = v_batch.event_id
      AND lower(trim(w.access_type)) = lower(trim(v_batch.name))
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_batches eb
        WHERE eb.wristband_id = w.id
          AND eb.id <> p_batch_id
      )
    ORDER BY w.created_at ASC
    LIMIT 1;

    IF v_wristband_id IS NULL THEN
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
    ELSE
      UPDATE public.wristbands w
      SET
        access_type = v_batch.name,
        price = v_batch.price,
        status = 'active'
      WHERE w.id = v_wristband_id;
    END IF;

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

    IF OLD.wristband_id IS NOT NULL
       AND public.event_uses_counter_inventory(OLD.event_id) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.event_batches eb
        WHERE eb.wristband_id = OLD.wristband_id
          AND eb.id <> OLD.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.wristband_analytics wa
        WHERE wa.wristband_id = OLD.wristband_id
          AND (
            wa.client_user_id IS NOT NULL
            OR wa.status IN ('used', 'checkout_pending')
          )
      ) THEN
        DELETE FROM public.wristband_analytics wa
        WHERE wa.wristband_id = OLD.wristband_id
          AND wa.client_user_id IS NULL;

        DELETE FROM public.wristbands w
        WHERE w.id = OLD.wristband_id;
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  IF public.event_uses_counter_inventory(COALESCE(NEW.event_id, OLD.event_id)) THEN
    PERFORM public.sync_event_batch_counter_assets(COALESCE(NEW.id, OLD.id));
  END IF;

  RETURN NEW;
END;
$$;

-- Remove pulseiras-template órfãs (não ligadas a nenhum lote atual)
CREATE OR REPLACE FUNCTION public.cleanup_orphan_counter_wristbands(p_event_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER := 0;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT w.id
    FROM public.wristbands w
    INNER JOIN public.events e ON e.id = w.event_id
    WHERE e.inventory_mode = 'counter'
      AND (p_event_id IS NULL OR w.event_id = p_event_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_batches eb
        WHERE eb.wristband_id = w.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.wristband_analytics wa
        WHERE wa.wristband_id = w.id
          AND (
            wa.client_user_id IS NOT NULL
            OR wa.status IN ('used', 'checkout_pending')
          )
      )
  LOOP
    DELETE FROM public.wristband_analytics wa
    WHERE wa.wristband_id = v_row.id
      AND wa.client_user_id IS NULL;

    DELETE FROM public.wristbands w
    WHERE w.id = v_row.id;

    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN v_deleted;
END;
$$;

-- Limpeza única dos dados já duplicados
SELECT public.cleanup_orphan_counter_wristbands(NULL);

REVOKE ALL ON FUNCTION public.cleanup_orphan_counter_wristbands(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_counter_wristbands(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.cleanup_orphan_counter_wristbands(UUID) IS
  'Remove pulseiras-template órfãs de eventos counter (código B… sem lote vinculado).';
