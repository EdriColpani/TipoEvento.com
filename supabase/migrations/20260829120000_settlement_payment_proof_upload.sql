-- Comprovante de arquivo (imagem/PDF) na liquidação manual D+1.
-- Armazena path no lote; gestores baixam via URL assinada do Storage.

ALTER TABLE public.credit_payout_batches
  ADD COLUMN IF NOT EXISTS payment_proof_path TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_file_name TEXT;

COMMENT ON COLUMN public.credit_payout_batches.payment_proof_path IS
  'Path no bucket settlement-proofs (ex.: {company_id}/{uuid}.pdf).';
COMMENT ON COLUMN public.credit_payout_batches.payment_proof_file_name IS
  'Nome original do arquivo de comprovante para exibição/download.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'settlement-proofs',
  'settlement-proofs',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "settlement_proofs_admin_all" ON storage.objects;
CREATE POLICY "settlement_proofs_admin_all"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'settlement-proofs'
  AND public.user_is_admin_master_for_rls()
)
WITH CHECK (
  bucket_id = 'settlement-proofs'
  AND public.user_is_admin_master_for_rls()
);

DROP POLICY IF EXISTS "settlement_proofs_manager_select" ON storage.objects;
CREATE POLICY "settlement_proofs_manager_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'settlement-proofs'
  AND EXISTS (
    SELECT 1
    FROM public.user_companies uc
    WHERE uc.user_id = auth.uid()
      AND uc.company_id::text = (storage.foldername(name))[1]
  )
);

DROP FUNCTION IF EXISTS public.register_admin_credit_settlement_payment(UUID, UUID[], TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.register_admin_credit_settlement_payment(
  p_company_id UUID,
  p_settlement_ids UUID[] DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'pix',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_payment_proof_path TEXT DEFAULT NULL,
  p_payment_proof_file_name TEXT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_total NUMERIC(12, 2) := 0;
  v_credit_total NUMERIC(12, 2) := 0;
  v_ticket_total NUMERIC(12, 2) := 0;
  v_count INTEGER := 0;
  v_credit_count INTEGER := 0;
  v_ticket_count INTEGER := 0;
  v_ref TEXT;
  v_method TEXT;
  v_company_name TEXT;
  v_deduction NUMERIC(12, 2) := 0;
  v_net_total NUMERIC(12, 2);
  v_notes TEXT;
  v_filter BOOLEAN;
  v_proof_path TEXT;
  v_proof_name TEXT;
BEGIN
  IF p_company_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master pode registrar liquidação manual.';
  END IF;

  v_proof_path := NULLIF(trim(p_payment_proof_path), '');
  IF v_proof_path IS NULL THEN
    RAISE EXCEPTION 'Comprovante de transferência (arquivo) é obrigatório.';
  END IF;
  IF position('../' in v_proof_path) > 0 OR left(v_proof_path, 1) = '/' THEN
    RAISE EXCEPTION 'Path do comprovante inválido.';
  END IF;
  IF split_part(v_proof_path, '/', 1) <> p_company_id::text THEN
    RAISE EXCEPTION 'Comprovante deve pertencer à pasta da empresa liquidada.';
  END IF;

  v_proof_name := NULLIF(trim(p_payment_proof_file_name), '');
  IF v_proof_name IS NULL THEN
    v_proof_name := reverse(split_part(reverse(v_proof_path), '/', 1));
  END IF;

  v_method := lower(COALESCE(NULLIF(trim(p_payment_method), ''), 'pix'));
  IF v_method NOT IN ('pix', 'ted', 'mp_transfer', 'other') THEN
    RAISE EXCEPTION 'Meio de pagamento inválido.';
  END IF;

  PERFORM public.process_credit_settlement_releases();
  PERFORM public.process_ticket_settlement_releases();

  v_filter := p_settlement_ids IS NOT NULL AND COALESCE(array_length(p_settlement_ids, 1), 0) > 0;

  IF v_filter THEN
    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_credit_total, v_credit_count
    FROM public.manager_credit_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released'
      AND id = ANY (p_settlement_ids);

    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_ticket_total, v_ticket_count
    FROM public.manager_ticket_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released'
      AND id = ANY (p_settlement_ids);
  ELSE
    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_credit_total, v_credit_count
    FROM public.manager_credit_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released';

    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_ticket_total, v_ticket_count
    FROM public.manager_ticket_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released';
  END IF;

  v_total := round(COALESCE(v_credit_total, 0) + COALESCE(v_ticket_total, 0), 2);
  v_count := COALESCE(v_credit_count, 0) + COALESCE(v_ticket_count, 0);

  IF v_count = 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Nenhum repasse liberado (D+1) disponível para pagamento.';
  END IF;

  v_ref := COALESCE(NULLIF(trim(p_payment_reference), ''), 'EF-MANUAL-' || gen_random_uuid()::text);
  SELECT corporate_name INTO v_company_name FROM public.companies WHERE id = p_company_id;
  v_notes := NULLIF(trim(p_notes), '');

  INSERT INTO public.credit_payout_batches (
    company_id,
    manager_user_id,
    total_amount,
    settlement_count,
    status,
    mp_payout_reference,
    payment_method,
    payment_reference,
    payment_proof_path,
    payment_proof_file_name,
    registered_by,
    notes,
    paid_at,
    gross_settlement_amount,
    ticket_chargeback_deduction
  ) VALUES (
    p_company_id,
    p_actor_user_id,
    round(v_total, 2),
    v_count,
    'paid',
    v_ref,
    v_method,
    v_ref,
    v_proof_path,
    v_proof_name,
    p_actor_user_id,
    v_notes,
    timezone('utc'::text, now()),
    round(v_total, 2),
    0
  )
  RETURNING id INTO v_batch_id;

  v_deduction := public.apply_ticket_chargeback_debts_to_payout(
    p_company_id,
    v_batch_id,
    round(v_total, 2)
  );
  v_net_total := round(greatest(0, v_total - COALESCE(v_deduction, 0)), 2);

  IF COALESCE(v_deduction, 0) > 0 THEN
    v_notes := trim(both E'\n' FROM concat_ws(
      E'\n',
      v_notes,
      format(
        'Desconto chargeback ingresso: R$ %s (bruto repasse R$ %s → líquido R$ %s).',
        to_char(v_deduction, 'FM999999990.00'),
        to_char(v_total, 'FM999999990.00'),
        to_char(v_net_total, 'FM999999990.00')
      )
    ));

    UPDATE public.credit_payout_batches
    SET
      total_amount = v_net_total,
      ticket_chargeback_deduction = round(v_deduction, 2),
      gross_settlement_amount = round(v_total, 2),
      notes = v_notes
    WHERE id = v_batch_id;
  END IF;

  IF v_filter THEN
    UPDATE public.manager_credit_settlement_ledger
    SET
      status = 'paid',
      paid_at = timezone('utc'::text, now()),
      payout_batch_id = v_batch_id,
      mp_payout_reference = v_ref,
      updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id
      AND status = 'released'
      AND id = ANY (p_settlement_ids);

    UPDATE public.manager_ticket_settlement_ledger
    SET
      status = 'paid',
      paid_at = timezone('utc'::text, now()),
      payout_batch_id = v_batch_id,
      payment_reference = v_ref,
      updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id
      AND status = 'released'
      AND id = ANY (p_settlement_ids);
  ELSE
    UPDATE public.manager_credit_settlement_ledger
    SET
      status = 'paid',
      paid_at = timezone('utc'::text, now()),
      payout_batch_id = v_batch_id,
      mp_payout_reference = v_ref,
      updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id
      AND status = 'released';

    UPDATE public.manager_ticket_settlement_ledger
    SET
      status = 'paid',
      paid_at = timezone('utc'::text, now()),
      payout_batch_id = v_batch_id,
      payment_reference = v_ref,
      updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id
      AND status = 'released';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'gross_settlement_amount', round(v_total, 2),
    'ticket_chargeback_deduction', round(COALESCE(v_deduction, 0), 2),
    'total_amount', v_net_total,
    'settlement_count', v_count,
    'credit_settlement_count', v_credit_count,
    'ticket_settlement_count', v_ticket_count,
    'payment_reference', v_ref,
    'payment_method', v_method,
    'payment_proof_path', v_proof_path,
    'payment_proof_file_name', v_proof_name,
    'company_name', v_company_name,
    'payout_bank', public.company_payout_bank_snapshot(p_company_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_admin_credit_settlement_payment(
  UUID, UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_manager_credit_settlements(
  p_company_id UUID,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
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
        'Crédito EventFest'::text AS source_label
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
        'Ingresso (D+1 banco)'::text AS source_label
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
    'payout_bank', public.company_payout_bank_snapshot(p_company_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_manager_credit_settlements(UUID, TEXT, INTEGER, INTEGER) TO authenticated;
