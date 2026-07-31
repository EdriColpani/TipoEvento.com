-- Pagamento aprovado depois que a reserva do checkout expirou ficava sem ingresso:
-- a confirmação de estoque exigia reserved >= quantidade e o cron de expiração já
-- havia devolvido a reserva. Com o dinheiro recebido, o ingresso tem que sair —
-- então caímos para o estoque disponível quando a reserva não existe mais.

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
  v_from_available BOOLEAN;
BEGIN
  SELECT * INTO v_r FROM public.receivables WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacao nao encontrada.';
  END IF;

  v_client := COALESCE(p_client_user_id, v_r.client_user_id);
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Cliente nao informado para materializacao.';
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
      RAISE EXCEPTION 'Item de reserva invalido na transacao.';
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
    v_from_available := false;

    IF v_rows = 0 THEN
      UPDATE public.batch_inventory bi
      SET
        sold = bi.sold + v_qty,
        updated_at = timezone('utc'::text, now())
      WHERE bi.batch_id = v_batch_id
        AND (bi.total - bi.sold - bi.reserved) >= v_qty;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_from_available := v_rows > 0;

      IF v_rows = 0 THEN
        RAISE EXCEPTION 'Lote "%" sem estoque para confirmar o pagamento ja aprovado.', v_name;
      END IF;
    END IF;

    SELECT * INTO v_wristband FROM public.wristbands WHERE id = v_wristband_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pulseira do lote nao encontrada.';
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
          'materialized_at', timezone('utc'::text, now()),
          'reservation_expired_before_payment', v_from_available
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
