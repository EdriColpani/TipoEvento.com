-- Relatório Admin Master: estoque de ingressos por empresa e evento.

CREATE OR REPLACE FUNCTION public.event_ticket_inventory_stats(p_event_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tickets_created', COUNT(*)::INTEGER,
    'tickets_sold', COUNT(*) FILTER (
      WHERE wa.client_user_id IS NOT NULL OR wa.status = 'used'
    )::INTEGER,
    'tickets_available', COUNT(*) FILTER (
      WHERE wa.status = 'active' AND wa.client_user_id IS NULL
    )::INTEGER
  )
  FROM public.wristband_analytics wa
  INNER JOIN public.wristbands w ON w.id = wa.wristband_id
  WHERE w.event_id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_companies_event_ticket_inventory(
  p_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode acessar este relatório.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_payload ORDER BY company_sort_name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      COALESCE(NULLIF(trim(c.trade_name), ''), c.corporate_name, 'Empresa') AS company_sort_name,
      jsonb_build_object(
        'company_id', c.id,
        'company_name', COALESCE(NULLIF(trim(c.trade_name), ''), c.corporate_name, 'Empresa'),
        'corporate_name', c.corporate_name,
        'billing_plan', c.billing_plan,
        'events', COALESCE(ev_agg.events, '[]'::jsonb),
        'totals', COALESCE(ev_agg.totals, jsonb_build_object(
          'tickets_created', 0,
          'tickets_sold', 0,
          'tickets_available', 0
        ))
      ) AS row_payload
    FROM public.companies c
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'event_id', e.id,
            'event_title', e.title,
            'event_date', e.date,
            'is_active', COALESCE(e.is_active, false),
            'is_draft', COALESCE(e.is_draft, false),
            'is_paid', COALESCE(e.is_paid, false),
            'tickets_created', COALESCE(st.tickets_created, 0),
            'tickets_sold', COALESCE(st.tickets_sold, 0),
            'tickets_available', COALESCE(st.tickets_available, 0)
          )
          ORDER BY e.date DESC NULLS LAST, e.title
        ) AS events,
        jsonb_build_object(
          'tickets_created', COALESCE(SUM(st.tickets_created), 0),
          'tickets_sold', COALESCE(SUM(st.tickets_sold), 0),
          'tickets_available', COALESCE(SUM(st.tickets_available), 0)
        ) AS totals
      FROM public.events e
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::INTEGER AS tickets_created,
          COUNT(*) FILTER (
            WHERE wa.client_user_id IS NOT NULL OR wa.status = 'used'
          )::INTEGER AS tickets_sold,
          COUNT(*) FILTER (
            WHERE wa.status = 'active' AND wa.client_user_id IS NULL
          )::INTEGER AS tickets_available
        FROM public.wristband_analytics wa
        INNER JOIN public.wristbands w ON w.id = wa.wristband_id
        WHERE w.event_id = e.id
      ) st ON true
      WHERE e.company_id = c.id
    ) ev_agg ON true
    WHERE p_company_id IS NULL OR c.id = p_company_id
  ) companies;

  RETURN jsonb_build_object('success', true, 'companies', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.event_ticket_inventory_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_companies_event_ticket_inventory(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_ticket_inventory_stats(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_companies_event_ticket_inventory(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_get_companies_event_ticket_inventory(UUID) IS
  'Admin Master: empresas, eventos e totais de ingressos criados, vendidos e disponíveis para venda.';
