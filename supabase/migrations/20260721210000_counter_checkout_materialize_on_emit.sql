-- Eventos counter: materializar ingressos antes da emissão (fallback quando webhook não rodou).

CREATE OR REPLACE FUNCTION public.client_emit_receivable_tickets(p_receivable_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.receivables%ROWTYPE;
  v_ids UUID[];
  v_updated INTEGER;
  v_materialize JSONB;
BEGIN
  SELECT *
  INTO v_r
  FROM public.receivables
  WHERE id = p_receivable_id
    AND client_user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'receivable_not_found');
  END IF;

  IF v_r.status <> 'paid'
     AND COALESCE(v_r.payment_status, '') NOT IN ('approved', 'authorized') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'receivable_not_paid');
  END IF;

  IF COALESCE(array_length(v_r.wristband_analytics_ids, 1), 0) = 0
     AND v_r.counter_reservation_items IS NOT NULL
     AND jsonb_array_length(v_r.counter_reservation_items) > 0 THEN
    v_materialize := public.materialize_counter_checkout_tickets(
      p_receivable_id,
      v_r.client_user_id
    );

    IF COALESCE((v_materialize->>'ok')::boolean, false) IS NOT TRUE
       AND COALESCE((v_materialize->>'skipped')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', COALESCE(v_materialize->>'error', 'Falha ao gerar ingressos do estoque.')
      );
    END IF;

    SELECT *
    INTO v_r
    FROM public.receivables
    WHERE id = p_receivable_id
      AND client_user_id = auth.uid();
  END IF;

  v_ids := COALESCE(v_r.wristband_analytics_ids, ARRAY[]::uuid[]);
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_analytics_ids');
  END IF;

  UPDATE public.wristband_analytics wa
  SET
    client_user_id = v_r.client_user_id,
    status = 'active',
    event_type = 'purchase',
    event_data = COALESCE(wa.event_data, '{}'::jsonb) || jsonb_build_object(
      'purchase_date', COALESCE(v_r.paid_at::text, to_jsonb(now())::text),
      'client_id', v_r.client_user_id,
      'transaction_id', v_r.id
    )
  WHERE wa.id = ANY (v_ids)
    AND (
      wa.client_user_id IS NULL
      OR wa.client_user_id = v_r.client_user_id
    )
    AND wa.status IN ('pending', 'active');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'updated', GREATEST(v_updated, COALESCE(array_length(v_ids, 1), 0)),
    'expected', COALESCE(array_length(v_ids, 1), 0),
    'materialized', COALESCE((v_materialize->>'materialized_count')::integer, 0)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', LEFT(SQLERRM, 300)
    );
END;
$$;

COMMENT ON FUNCTION public.client_emit_receivable_tickets(UUID) IS
  'Materializa (counter) e vincula ingressos ao cliente após pagamento aprovado.';
