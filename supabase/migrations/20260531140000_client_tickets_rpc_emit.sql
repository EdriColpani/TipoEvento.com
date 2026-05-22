-- Cliente: ler ingressos e forçar emissão quando o MP aprovou mas o webhook não vinculou.

-- Leitura das próprias compras (necessário para policies e UI)
DROP POLICY IF EXISTS "receivables_select_own_client" ON public.receivables;
CREATE POLICY "receivables_select_own_client"
  ON public.receivables
  FOR SELECT
  TO authenticated
  USING (client_user_id = auth.uid());

-- Leitura de wristbands pelo cliente: feita via RPC get_my_client_tickets (SECURITY DEFINER).
-- Não criar policy em wristbands referenciando wristband_analytics (causa recursão RLS / HTTP 500).

CREATE OR REPLACE FUNCTION public.get_my_client_tickets()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(row_payload ORDER BY created_at DESC)
      FROM (
        SELECT
          wa.created_at,
          jsonb_build_object(
            'id', wa.id,
            'code_wristbands', wa.code_wristbands,
            'status', wa.status,
            'created_at', wa.created_at,
            'event_type', wa.event_type,
            'event_data', wa.event_data,
            'wristbands', jsonb_build_object(
              'access_type', w.access_type,
              'price', w.price,
              'events', jsonb_build_object(
                'id', e.id,
                'title', e.title,
                'location', e.location,
                'date', e.date
              )
            )
          ) AS row_payload
        FROM public.wristband_analytics wa
        INNER JOIN public.wristbands w ON w.id = wa.wristband_id
        INNER JOIN public.events e ON e.id = w.event_id
        WHERE
          wa.client_user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.receivables r
            WHERE r.client_user_id = auth.uid()
              AND (
                r.status = 'paid'
                OR COALESCE(r.payment_status::text, '') IN ('approved', 'authorized')
              )
              AND wa.id = ANY (COALESCE(r.wristband_analytics_ids, ARRAY[]::uuid[]))
          )
      ) AS rows
    ),
    '[]'::jsonb
  );
$$;

COMMENT ON FUNCTION public.get_my_client_tickets() IS
  'Lista ingressos do cliente (próprios + reservados em compras pagas/aprovadas), com dados do evento.';

REVOKE ALL ON FUNCTION public.get_my_client_tickets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_client_tickets() TO authenticated;

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
    'updated', v_updated,
    'expected', COALESCE(array_length(v_ids, 1), 0)
  );
END;
$$;

COMMENT ON FUNCTION public.client_emit_receivable_tickets(UUID) IS
  'Vincula ingressos reservados ao cliente após pagamento (fallback quando webhook não concluiu).';

REVOKE ALL ON FUNCTION public.client_emit_receivable_tickets(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_emit_receivable_tickets(UUID) TO authenticated;
