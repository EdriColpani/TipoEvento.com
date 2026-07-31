-- Série diária de lançamentos de comissão da plataforma (Admin Master).
-- Ingresso: financial_splits.platform_amount (exclui splits revertidos por chargeback).
-- Consumo: credit_financial_splits.platform_amount, separado entre evento e empresa parceira.
-- Datas normalizadas para o fuso de Brasília (mesmo dia que o gestor enxerga no painel).

CREATE OR REPLACE FUNCTION public.get_admin_commission_daily_series(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE;
  v_end DATE;
  v_items JSONB;
  v_ticket NUMERIC(14, 2) := 0;
  v_event NUMERIC(14, 2) := 0;
  v_partner NUMERIC(14, 2) := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  v_end := COALESCE(p_end_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_start := COALESCE(p_start_date, v_end - 29);

  IF v_start > v_end THEN
    RAISE EXCEPTION 'Período inválido.';
  END IF;

  IF v_end - v_start > 366 THEN
    RAISE EXCEPTION 'Período máximo de 366 dias.';
  END IF;

  WITH days AS (
    SELECT generate_series(v_start, v_end, INTERVAL '1 day')::date AS bucket_date
  ),
  ticket AS (
    SELECT
      (r.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS bucket_date,
      SUM(fs.platform_amount) AS amount
    FROM public.financial_splits fs
    INNER JOIN public.receivables r ON r.id = fs.transaction_id
    WHERE fs.platform_amount > 0
      AND fs.reversed_by_chargeback_case_id IS NULL
      AND (
        COALESCE(r.status, '') = 'paid'
        OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
      )
      AND (r.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  consumption AS (
    SELECT
      (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS bucket_date,
      SUM(s.platform_amount) FILTER (WHERE o.receiver_event_id IS NOT NULL) AS event_amount,
      SUM(s.platform_amount) FILTER (WHERE o.receiver_event_id IS NULL) AS partner_amount
    FROM public.credit_spend_orders o
    INNER JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
    WHERE o.status = 'completed'
      AND s.platform_amount > 0
      AND (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  series AS (
    SELECT
      d.bucket_date,
      COALESCE(t.amount, 0)::NUMERIC(14, 2) AS ticket_commission,
      COALESCE(c.event_amount, 0)::NUMERIC(14, 2) AS consumption_event_commission,
      COALESCE(c.partner_amount, 0)::NUMERIC(14, 2) AS consumption_partner_commission
    FROM days d
    LEFT JOIN ticket t ON t.bucket_date = d.bucket_date
    LEFT JOIN consumption c ON c.bucket_date = d.bucket_date
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bucket_date', bucket_date,
          'ticket_commission', ticket_commission,
          'consumption_event_commission', consumption_event_commission,
          'consumption_partner_commission', consumption_partner_commission,
          'total_commission',
            ticket_commission + consumption_event_commission + consumption_partner_commission
        )
        ORDER BY bucket_date
      ),
      '[]'::jsonb
    ),
    COALESCE(SUM(ticket_commission), 0),
    COALESCE(SUM(consumption_event_commission), 0),
    COALESCE(SUM(consumption_partner_commission), 0)
  INTO v_items, v_ticket, v_event, v_partner
  FROM series;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
    'items', v_items,
    'summary', jsonb_build_object(
      'ticket_commission', v_ticket,
      'consumption_event_commission', v_event,
      'consumption_partner_commission', v_partner,
      'consumption_commission', round(v_event + v_partner, 2),
      'total_commission', round(v_ticket + v_event + v_partner, 2)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_commission_daily_series(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_commission_daily_series(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_admin_commission_daily_series(DATE, DATE) IS
  'Admin Master: série diária de comissões (ingresso + consumo em evento/empresa parceira).';
