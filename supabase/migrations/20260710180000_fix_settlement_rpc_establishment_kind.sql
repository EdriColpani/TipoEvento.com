-- Corrige RPCs de repasse: coluna establishment_kind não existe em credit_establishments.

CREATE OR REPLACE FUNCTION public.list_manager_credit_settlements(
  p_company_id UUID,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_summary JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.release_at ASC, t.spend_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.id,
      m.company_id,
      m.spend_order_id,
      m.split_id,
      m.manager_amount,
      s.gross_amount,
      s.platform_amount,
      m.status,
      m.release_at,
      m.released_at,
      m.paid_at,
      m.payout_batch_id,
      m.mp_payout_reference AS payment_reference,
      b.payment_method,
      o.public_description AS spend_description,
      o.created_at AS spend_at,
      o.channel,
      o.receiver_event_id,
      o.receiver_establishment_id,
      e.title AS event_title,
      ce.name AS establishment_name,
      NULL::text AS establishment_kind
    FROM public.manager_credit_settlement_ledger m
    INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
    INNER JOIN public.credit_financial_splits s ON s.id = m.split_id
    LEFT JOIN public.events e ON e.id = o.receiver_event_id
    LEFT JOIN public.credit_establishments ce ON ce.id = o.receiver_establishment_id
    LEFT JOIN public.credit_payout_batches b ON b.id = m.payout_batch_id
    WHERE m.company_id = p_company_id
      AND (p_status IS NULL OR m.status = p_status)
    ORDER BY m.release_at ASC, o.created_at ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  SELECT jsonb_build_object(
    'pending_retention', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'awaiting_payment', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0),
    'paid', COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN status = 'clawback' THEN manager_amount ELSE 0 END), 0),
    'pending', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'released', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0)
  )
  INTO v_summary
  FROM public.manager_credit_settlement_ledger
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'items', v_rows,
    'summary', v_summary,
    'retention_days', public.get_credit_settlement_retention_days(),
    'settlement_mode', 'manual_d1'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_settlements(
  p_status TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 500,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_summary JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.company_name ASC, t.release_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.id,
      m.company_id,
      c.corporate_name AS company_name,
      m.spend_order_id,
      m.split_id,
      m.manager_amount,
      s.gross_amount,
      s.platform_amount,
      s.applied_percentage,
      m.status,
      m.release_at,
      m.released_at,
      m.paid_at,
      m.payout_batch_id,
      m.mp_payout_reference AS payment_reference,
      b.payment_method,
      b.notes AS payout_notes,
      o.public_description AS spend_description,
      o.created_at AS spend_at,
      o.channel,
      o.client_user_id,
      o.receiver_event_id,
      o.receiver_establishment_id,
      e.title AS event_title,
      ce.name AS establishment_name,
      NULL::text AS establishment_kind,
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
    LEFT JOIN public.companies c ON c.id = m.company_id
    LEFT JOIN public.events e ON e.id = o.receiver_event_id
    LEFT JOIN public.credit_establishments ce ON ce.id = o.receiver_establishment_id
    LEFT JOIN public.credit_payout_batches b ON b.id = m.payout_batch_id
    WHERE (p_status IS NULL OR m.status = p_status)
      AND (p_company_id IS NULL OR m.company_id = p_company_id)
    ORDER BY c.corporate_name ASC NULLS LAST, m.release_at ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 500), 2000))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  SELECT jsonb_build_object(
    'pending_retention', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'awaiting_payment', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0),
    'paid', COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN status = 'clawback' THEN manager_amount ELSE 0 END), 0)
  )
  INTO v_summary
  FROM public.manager_credit_settlement_ledger m
  WHERE (p_status IS NULL OR m.status = p_status)
    AND (p_company_id IS NULL OR m.company_id = p_company_id);

  RETURN jsonb_build_object('items', v_rows, 'summary', v_summary, 'settlement_mode', 'manual_d1');
END;
$$;
