-- Corrige list_admin_credit_settlements_grouped (erro GROUP BY em subquery correlacionada).

CREATE OR REPLACE FUNCTION public.list_admin_credit_settlements_grouped(
  p_status TEXT DEFAULT 'released'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_companies JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();

  WITH base AS (
    SELECT
      m.id,
      m.company_id,
      m.spend_order_id,
      m.manager_amount,
      m.status,
      m.release_at,
      m.released_at,
      c.corporate_name AS company_name,
      o.public_description AS spend_description,
      o.created_at AS spend_at,
      o.channel,
      s.gross_amount,
      s.platform_amount,
      CASE
        WHEN o.receiver_event_id IS NOT NULL THEN 'event'
        WHEN o.receiver_establishment_id IS NOT NULL THEN 'establishment'
        ELSE 'company'
      END AS group_type,
      COALESCE(o.receiver_event_id::text, o.receiver_establishment_id::text, m.company_id::text) AS group_key,
      COALESCE(e.title, ce.name, c.corporate_name) AS group_label
    FROM public.manager_credit_settlement_ledger m
    INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
    INNER JOIN public.credit_financial_splits s ON s.id = m.split_id
    INNER JOIN public.companies c ON c.id = m.company_id
    LEFT JOIN public.events e ON e.id = o.receiver_event_id
    LEFT JOIN public.credit_establishments ce ON ce.id = o.receiver_establishment_id
    WHERE p_status IS NULL OR m.status = p_status
  ),
  grouped AS (
    SELECT
      company_id,
      company_name,
      group_type,
      group_key,
      group_label,
      COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0) AS awaiting_payment_total,
      COUNT(*) AS item_count,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'spend_order_id', spend_order_id,
            'manager_amount', manager_amount,
            'status', status,
            'release_at', release_at,
            'released_at', released_at,
            'gross_amount', gross_amount,
            'platform_amount', platform_amount,
            'spend_description', spend_description,
            'spend_at', spend_at,
            'channel', channel
          )
          ORDER BY spend_at ASC
        ),
        '[]'::jsonb
      ) AS items
    FROM base
    GROUP BY company_id, company_name, group_type, group_key, group_label
  ),
  company_totals AS (
    SELECT
      company_id,
      company_name,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0) AS pending_retention_total,
      COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0) AS awaiting_payment_total,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0) AS paid_total
    FROM base
    GROUP BY company_id, company_name
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'company_id', ct.company_id,
        'company_name', ct.company_name,
        'pending_retention_total', ct.pending_retention_total,
        'awaiting_payment_total', ct.awaiting_payment_total,
        'paid_total', ct.paid_total,
        'groups', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'group_type', g.group_type,
                'group_key', g.group_key,
                'group_label', g.group_label,
                'awaiting_payment_total', g.awaiting_payment_total,
                'item_count', g.item_count,
                'items', g.items
              )
              ORDER BY g.group_label
            )
            FROM grouped g
            WHERE g.company_id = ct.company_id
          ),
          '[]'::jsonb
        )
      )
      ORDER BY ct.company_name
    ),
    '[]'::jsonb
  )
  INTO v_companies
  FROM company_totals ct;

  RETURN jsonb_build_object('companies', v_companies, 'settlement_mode', 'manual_d1');
END;
$$;
