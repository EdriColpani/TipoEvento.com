-- Admin conferência: devolver path do PDF/imagem do comprovante (já gravado no lote).

CREATE OR REPLACE FUNCTION public.list_admin_credit_settlements(
  p_status TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 500,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
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
        'Ingresso (D+1 banco)'::text AS source_label,
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
    'settlement_mode', 'manual_d1'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_credit_settlements(TEXT, UUID, INTEGER, INTEGER) TO authenticated;
