-- Fase 4: listagens de repasse expõem settlement_funding_type + release_at no grouped.
-- Textos sem “D+1” universal (PIX/débito D+1 · cartão D+30 / data MP).

SELECT public.security_open_change_window('settlement funding labels phase 4 list rpcs', 30);

CREATE OR REPLACE FUNCTION public.list_manager_credit_settlements(
  p_company_id UUID,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_summary JSONB;
  v_credit_sum JSONB;
  v_ticket_sum JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id)
     AND NOT public.user_owns_company(p_company_id, auth.uid())
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.process_credit_settlement_releases();
  PERFORM public.process_ticket_settlement_releases();

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.spend_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT * FROM (
      SELECT
        m.id,
        m.company_id,
        m.spend_order_id,
        m.split_id,
        NULL::uuid AS receivable_id,
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
        b.payment_proof_path,
        b.payment_proof_file_name,
        o.public_description AS spend_description,
        o.created_at AS spend_at,
        o.channel,
        e.title AS event_title,
        ce.name AS establishment_name,
        NULL::text AS establishment_kind,
        'credit'::text AS source_type,
        'Crédito EventFest'::text AS source_label,
        m.settlement_funding_type,
        m.settlement_delay_days
      FROM public.manager_credit_settlement_ledger m
      INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
      INNER JOIN public.credit_financial_splits s ON s.id = m.split_id
      LEFT JOIN public.events e ON e.id = o.receiver_event_id
      LEFT JOIN public.credit_establishments ce ON ce.id = o.receiver_establishment_id
      LEFT JOIN public.credit_payout_batches b ON b.id = m.payout_batch_id
      WHERE m.company_id = p_company_id
        AND (p_status IS NULL OR m.status = p_status)

      UNION ALL

      SELECT
        t.id,
        t.company_id,
        NULL::uuid AS spend_order_id,
        NULL::uuid AS split_id,
        t.receivable_id,
        t.manager_amount,
        t.gross_amount,
        t.platform_fee AS platform_amount,
        t.status,
        t.release_at,
        t.released_at,
        t.paid_at,
        t.payout_batch_id,
        COALESCE(t.payment_reference, b.payment_reference) AS payment_reference,
        b.payment_method,
        b.payment_proof_path,
        b.payment_proof_file_name,
        COALESCE(e.title, 'Venda de ingresso') AS spend_description,
        t.created_at AS spend_at,
        'ticket_mp'::text AS channel,
        e.title AS event_title,
        NULL::text AS establishment_name,
        NULL::text AS establishment_kind,
        'ticket'::text AS source_type,
        'Ingresso (modo banco)'::text AS source_label,
        t.settlement_funding_type,
        t.settlement_delay_days
      FROM public.manager_ticket_settlement_ledger t
      LEFT JOIN public.events e ON e.id = t.event_id
      LEFT JOIN public.credit_payout_batches b ON b.id = t.payout_batch_id
      WHERE t.company_id = p_company_id
        AND (p_status IS NULL OR t.status = p_status)
    ) u
    ORDER BY u.spend_at DESC
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
  INTO v_credit_sum
  FROM public.manager_credit_settlement_ledger
  WHERE company_id = p_company_id;

  SELECT jsonb_build_object(
    'pending_retention', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'awaiting_payment', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0),
    'paid', COALESCE(SUM(CASE WHEN status = 'paid' THEN manager_amount ELSE 0 END), 0),
    'clawback', COALESCE(SUM(CASE WHEN status = 'clawback' THEN manager_amount ELSE 0 END), 0),
    'pending', COALESCE(SUM(CASE WHEN status = 'pending' THEN manager_amount ELSE 0 END), 0),
    'released', COALESCE(SUM(CASE WHEN status = 'released' THEN manager_amount ELSE 0 END), 0)
  )
  INTO v_ticket_sum
  FROM public.manager_ticket_settlement_ledger
  WHERE company_id = p_company_id;

  v_summary := jsonb_build_object(
    'pending_retention',
      round(COALESCE((v_credit_sum->>'pending_retention')::numeric, 0)
        + COALESCE((v_ticket_sum->>'pending_retention')::numeric, 0), 2),
    'awaiting_payment',
      round(COALESCE((v_credit_sum->>'awaiting_payment')::numeric, 0)
        + COALESCE((v_ticket_sum->>'awaiting_payment')::numeric, 0), 2),
    'paid',
      round(COALESCE((v_credit_sum->>'paid')::numeric, 0)
        + COALESCE((v_ticket_sum->>'paid')::numeric, 0), 2),
    'clawback',
      round(COALESCE((v_credit_sum->>'clawback')::numeric, 0)
        + COALESCE((v_ticket_sum->>'clawback')::numeric, 0), 2),
    'pending',
      round(COALESCE((v_credit_sum->>'pending')::numeric, 0)
        + COALESCE((v_ticket_sum->>'pending')::numeric, 0), 2),
    'released',
      round(COALESCE((v_credit_sum->>'released')::numeric, 0)
        + COALESCE((v_ticket_sum->>'released')::numeric, 0), 2),
    'credit', v_credit_sum,
    'ticket', v_ticket_sum
  );

  RETURN jsonb_build_object(
    'items', v_rows,
    'summary', v_summary,
    'retention_days', public.get_credit_settlement_retention_days(),
    'settlement_mode', 'manual_d1',
    'settlement_policy', 'PIX/débito D+1 · cartão D+30 (ou data MP)',
    'payout_bank', public.company_payout_bank_snapshot(p_company_id)
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_summary JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master.';
  END IF;

  PERFORM public.process_credit_settlement_releases();
  PERFORM public.process_ticket_settlement_releases();

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.spend_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT * FROM (
      SELECT
        m.id,
        m.company_id,
        c.corporate_name AS company_name,
        m.spend_order_id,
        m.split_id,
        NULL::uuid AS receivable_id,
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
        b.payment_proof_path,
        b.payment_proof_file_name,
        o.public_description AS spend_description,
        o.created_at AS spend_at,
        o.channel,
        o.client_user_id,
        e.title AS event_title,
        ce.name AS establishment_name,
        'credit'::text AS source_type,
        'Crédito EventFest'::text AS source_label,
        m.settlement_funding_type,
        m.settlement_delay_days,
        public.company_payout_bank_snapshot(m.company_id) AS payout_bank
      FROM public.manager_credit_settlement_ledger m
      INNER JOIN public.companies c ON c.id = m.company_id
      INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
      INNER JOIN public.credit_financial_splits s ON s.id = m.split_id
      LEFT JOIN public.events e ON e.id = o.receiver_event_id
      LEFT JOIN public.credit_establishments ce ON ce.id = o.receiver_establishment_id
      LEFT JOIN public.credit_payout_batches b ON b.id = m.payout_batch_id
      WHERE (p_company_id IS NULL OR m.company_id = p_company_id)
        AND (p_status IS NULL OR m.status = p_status)

      UNION ALL

      SELECT
        t.id,
        t.company_id,
        c.corporate_name AS company_name,
        NULL::uuid AS spend_order_id,
        NULL::uuid AS split_id,
        t.receivable_id,
        t.manager_amount,
        t.gross_amount,
        t.platform_fee AS platform_amount,
        NULL::numeric AS applied_percentage,
        t.status,
        t.release_at,
        t.released_at,
        t.paid_at,
        t.payout_batch_id,
        COALESCE(t.payment_reference, b.payment_reference) AS payment_reference,
        b.payment_method,
        b.notes AS payout_notes,
        b.payment_proof_path,
        b.payment_proof_file_name,
        COALESCE(e.title, 'Venda de ingresso') AS spend_description,
        t.created_at AS spend_at,
        'ticket_mp'::text AS channel,
        r.client_user_id,
        e.title AS event_title,
        NULL::text AS establishment_name,
        'ticket'::text AS source_type,
        'Ingresso (modo banco)'::text AS source_label,
        t.settlement_funding_type,
        t.settlement_delay_days,
        public.company_payout_bank_snapshot(t.company_id) AS payout_bank
      FROM public.manager_ticket_settlement_ledger t
      INNER JOIN public.companies c ON c.id = t.company_id
      LEFT JOIN public.events e ON e.id = t.event_id
      LEFT JOIN public.receivables r ON r.id = t.receivable_id
      LEFT JOIN public.credit_payout_batches b ON b.id = t.payout_batch_id
      WHERE (p_company_id IS NULL OR t.company_id = p_company_id)
        AND (p_status IS NULL OR t.status = p_status)
    ) u
    ORDER BY u.spend_at DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 500), 2000))
    OFFSET greatest(0, COALESCE(p_offset, 0))
  ) t;

  SELECT jsonb_build_object(
    'pending_retention', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'pending'), 0),
    'awaiting_payment', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'released'), 0),
    'paid', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'paid'), 0),
    'clawback', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'clawback'), 0),
    'pending', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'pending'), 0),
    'released', COALESCE(SUM(x.amt) FILTER (WHERE x.st = 'released'), 0)
  )
  INTO v_summary
  FROM (
    SELECT manager_amount AS amt, status AS st
    FROM public.manager_credit_settlement_ledger
    WHERE p_company_id IS NULL OR company_id = p_company_id
    UNION ALL
    SELECT manager_amount, status
    FROM public.manager_ticket_settlement_ledger
    WHERE p_company_id IS NULL OR company_id = p_company_id
  ) x;

  RETURN jsonb_build_object(
    'items', v_rows,
    'summary', v_summary,
    'settlement_mode', 'manual_d1',
    'settlement_policy', 'PIX/débito D+1 · cartão D+30 (ou data MP)'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_credit_settlements_grouped(
  p_status TEXT DEFAULT 'released'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_companies JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master.';
  END IF;

  v_status := COALESCE(NULLIF(trim(p_status), ''), 'released');
  IF v_status NOT IN ('pending', 'released', 'paid', 'clawback') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  PERFORM public.process_credit_settlement_releases();
  PERFORM public.process_ticket_settlement_releases();

  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.company_name), '[]'::jsonb)
  INTO v_companies
  FROM (
    SELECT
      x.company_id,
      x.company_name,
      round(SUM(CASE WHEN x.status = 'pending' THEN x.manager_amount ELSE 0 END), 2) AS pending_retention_total,
      round(SUM(CASE WHEN x.status = 'released' THEN x.manager_amount ELSE 0 END), 2) AS awaiting_payment_total,
      round(SUM(CASE WHEN x.status = 'paid' THEN x.manager_amount ELSE 0 END), 2) AS paid_total,
      public.company_payout_bank_snapshot(x.company_id) AS payout_bank,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(g)::jsonb ORDER BY g.group_label), '[]'::jsonb)
        FROM (
          SELECT
            g0.group_type,
            g0.group_key,
            g0.group_label,
            round(SUM(g0.manager_amount), 2) AS awaiting_payment_total,
            COUNT(*)::integer AS item_count,
            jsonb_agg(row_to_json(g0)::jsonb ORDER BY g0.spend_at DESC) AS items
          FROM (
            SELECT
              m.company_id,
              CASE
                WHEN o.receiver_event_id IS NOT NULL THEN 'event'
                WHEN o.receiver_establishment_id IS NOT NULL THEN 'establishment'
                ELSE 'company'
              END AS group_type,
              COALESCE(o.receiver_event_id::text, o.receiver_establishment_id::text, m.company_id::text) AS group_key,
              COALESCE(e.title, ce.name, c.corporate_name, 'Empresa') AS group_label,
              m.id,
              m.manager_amount,
              m.status,
              m.release_at,
              m.settlement_funding_type,
              m.settlement_delay_days,
              o.created_at AS spend_at,
              o.public_description AS spend_description,
              'credit'::text AS source_type,
              'Crédito EventFest'::text AS source_label,
              e.title AS event_title,
              ce.name AS establishment_name
            FROM public.manager_credit_settlement_ledger m
            INNER JOIN public.companies c ON c.id = m.company_id
            INNER JOIN public.credit_spend_orders o ON o.id = m.spend_order_id
            LEFT JOIN public.events e ON e.id = o.receiver_event_id
            LEFT JOIN public.credit_establishments ce ON ce.id = o.receiver_establishment_id
            WHERE m.company_id = x.company_id
              AND m.status = v_status

            UNION ALL

            SELECT
              t.company_id,
              'event'::text AS group_type,
              COALESCE(t.event_id::text, t.company_id::text) AS group_key,
              COALESCE(e2.title, c2.corporate_name, 'Ingressos (modo banco)') AS group_label,
              t.id,
              t.manager_amount,
              t.status,
              t.release_at,
              t.settlement_funding_type,
              t.settlement_delay_days,
              t.created_at AS spend_at,
              COALESCE(e2.title, 'Venda de ingresso') AS spend_description,
              'ticket'::text AS source_type,
              'Ingresso (modo banco)'::text AS source_label,
              e2.title AS event_title,
              NULL::text AS establishment_name
            FROM public.manager_ticket_settlement_ledger t
            INNER JOIN public.companies c2 ON c2.id = t.company_id
            LEFT JOIN public.events e2 ON e2.id = t.event_id
            WHERE t.company_id = x.company_id
              AND t.status = v_status
          ) g0
          GROUP BY g0.group_type, g0.group_key, g0.group_label
        ) g
      ) AS groups
    FROM (
      SELECT m.company_id, c.corporate_name AS company_name, m.manager_amount, m.status
      FROM public.manager_credit_settlement_ledger m
      INNER JOIN public.companies c ON c.id = m.company_id
      WHERE m.status = v_status
      UNION ALL
      SELECT t.company_id, c.corporate_name, t.manager_amount, t.status
      FROM public.manager_ticket_settlement_ledger t
      INNER JOIN public.companies c ON c.id = t.company_id
      WHERE t.status = v_status
    ) x
    GROUP BY x.company_id, x.company_name
    HAVING SUM(x.manager_amount) > 0
  ) c;

  RETURN jsonb_build_object(
    'companies', COALESCE(v_companies, '[]'::jsonb),
    'status', v_status,
    'settlement_mode', 'manual_d1',
    'settlement_policy', 'PIX/débito D+1 · cartão D+30 (ou data MP)'
  );
END;
$$;
