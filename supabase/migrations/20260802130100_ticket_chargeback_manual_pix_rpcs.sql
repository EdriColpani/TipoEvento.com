-- RPCs: criar debt com recovery_mode; cobrança/baixa manual; listas enriquecidas

CREATE OR REPLACE FUNCTION public.ticket_handle_mp_chargeback(
  p_receivable_id UUID,
  p_mp_payment_id TEXT,
  p_mp_status TEXT DEFAULT 'charged_back',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recv public.receivables%ROWTYPE;
  v_case_id UUID;
  v_idem TEXT;
  v_mp_status TEXT;
  v_reason TEXT;
  v_company_id UUID;
  v_event_title TEXT;
  v_manager_net NUMERIC(12, 2) := 0;
  v_platform_fee NUMERIC(12, 2) := 0;
  v_gross NUMERIC(12, 2) := 0;
  v_cancelled INTEGER := 0;
  v_already_used BOOLEAN := false;
  v_needs_review BOOLEAN := false;
  v_analytics_ids UUID[];
  v_debt_id UUID;
  v_is_partial BOOLEAN := false;
  v_recovery TEXT := 'manual_pix';
BEGIN
  IF p_receivable_id IS NULL OR p_mp_payment_id IS NULL OR trim(p_mp_payment_id) = '' THEN
    RAISE EXCEPTION 'Parametros invalidos para chargeback de ingresso.';
  END IF;

  v_mp_status := COALESCE(NULLIF(trim(p_mp_status), ''), 'charged_back');
  v_is_partial := (v_mp_status = 'partially_refunded');
  v_reason := COALESCE(
    NULLIF(trim(p_reason), ''),
    format('Chargeback Mercado Pago na compra de ingresso (%s).', v_mp_status)
  );
  v_idem := 'ticket_chargeback:' || trim(p_mp_payment_id);

  SELECT id INTO v_case_id
  FROM public.ticket_chargeback_cases
  WHERE idempotency_key = v_idem OR mp_payment_id = trim(p_mp_payment_id);

  IF v_case_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'chargeback_case_id', v_case_id);
  END IF;

  SELECT * INTO v_recv FROM public.receivables WHERE id = p_receivable_id FOR UPDATE;

  IF v_recv.id IS NULL THEN
    RAISE EXCEPTION 'Receivable nao encontrado.';
  END IF;

  IF v_recv.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'reason', 'already_refunded', 'receivable_id', v_recv.id);
  END IF;

  IF v_recv.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'not_paid', 'status', v_recv.status, 'receivable_id', v_recv.id);
  END IF;

  IF v_recv.mp_payment_id IS NOT NULL AND trim(v_recv.mp_payment_id) <> trim(p_mp_payment_id) THEN
    RAISE EXCEPTION 'mp_payment_id nao corresponde ao receivable.';
  END IF;

  IF v_is_partial THEN
    v_needs_review := true;
  END IF;

  SELECT e.company_id, e.title INTO v_company_id, v_event_title
  FROM public.events e WHERE e.id = v_recv.event_id;

  v_recovery := COALESCE(
    public.company_ticket_chargeback_recovery_mode(v_company_id),
    'manual_pix'
  );

  SELECT COALESCE(SUM(fs.manager_amount), 0), COALESCE(SUM(fs.platform_amount), 0)
  INTO v_manager_net, v_platform_fee
  FROM public.financial_splits fs
  WHERE fs.transaction_id = v_recv.id AND fs.reversed_by_chargeback_case_id IS NULL;

  v_gross := round(COALESCE(NULLIF(v_recv.gross_amount, 0), v_recv.total_value, 0), 2);
  IF v_manager_net <= 0 THEN
    v_manager_net := round(greatest(0, COALESCE(v_recv.net_amount_after_mp, 0) - COALESCE(v_recv.platform_fee_amount, 0)), 2);
  END IF;
  IF v_platform_fee <= 0 THEN
    v_platform_fee := round(COALESCE(v_recv.platform_fee_amount, 0), 2);
  END IF;

  v_analytics_ids := COALESCE(v_recv.wristband_analytics_ids, ARRAY[]::uuid[]);

  IF cardinality(v_analytics_ids) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.wristband_analytics wa
      WHERE wa.id = ANY (v_analytics_ids) AND wa.status = 'used'
    ) INTO v_already_used;

    IF NOT v_is_partial THEN
      UPDATE public.wristband_analytics wa
      SET status = 'cancelled'
      WHERE wa.id = ANY (v_analytics_ids) AND wa.status IS DISTINCT FROM 'cancelled';
      GET DIAGNOSTICS v_cancelled = ROW_COUNT;

      UPDATE public.wristbands w
      SET status = 'cancelled'
      WHERE w.id IN (
        SELECT wa.wristband_id FROM public.wristband_analytics wa
        WHERE wa.id = ANY (v_analytics_ids) AND wa.wristband_id IS NOT NULL
      ) AND w.status IS DISTINCT FROM 'cancelled';
    END IF;
  END IF;

  INSERT INTO public.ticket_chargeback_cases (
    receivable_id, event_id, company_id, client_user_id, manager_user_id,
    mp_payment_id, mp_status, gross_amount, platform_fee_amount, manager_net_amount,
    tickets_cancelled_count, already_checked_in, needs_manual_review, reason, idempotency_key, metadata
  ) VALUES (
    v_recv.id, v_recv.event_id, v_company_id, v_recv.client_user_id, v_recv.manager_user_id,
    trim(p_mp_payment_id), v_mp_status, v_gross, round(v_platform_fee, 2), round(v_manager_net, 2),
    v_cancelled, COALESCE(v_already_used, false), v_needs_review, v_reason, v_idem,
    jsonb_build_object(
      'event_title', v_event_title,
      'analytics_ids', to_jsonb(v_analytics_ids),
      'partial', v_is_partial,
      'recovery_mode', v_recovery
    )
  ) RETURNING id INTO v_case_id;

  UPDATE public.financial_splits
  SET reversed_by_chargeback_case_id = v_case_id
  WHERE transaction_id = v_recv.id AND reversed_by_chargeback_case_id IS NULL;

  UPDATE public.receivables
  SET
    status = CASE WHEN v_is_partial THEN status ELSE 'refunded' END,
    payment_status = v_mp_status,
    mp_payment_id = COALESCE(mp_payment_id, trim(p_mp_payment_id)),
    updated_at = timezone('utc'::text, now())
  WHERE id = v_recv.id;

  IF v_company_id IS NOT NULL AND round(v_manager_net, 2) > 0 AND NOT v_is_partial THEN
    INSERT INTO public.manager_ticket_chargeback_debt (
      chargeback_case_id, company_id, manager_user_id, amount_due, amount_applied, status, recovery_mode
    ) VALUES (
      v_case_id, v_company_id, v_recv.manager_user_id, round(v_manager_net, 2), 0, 'open', v_recovery
    ) RETURNING id INTO v_debt_id;
  END IF;

  INSERT INTO public.payment_events (
    transaction_id, source, payment_status, receivable_status, payment_status_detail, mp_payment_id, payload
  ) VALUES (
    v_recv.id, 'webhook', v_mp_status,
    CASE WHEN v_is_partial THEN v_recv.status ELSE 'refunded' END,
    v_reason, trim(p_mp_payment_id),
    jsonb_build_object(
      'stage', 'ticket_chargeback',
      'chargeback_case_id', v_case_id,
      'debt_id', v_debt_id,
      'tickets_cancelled', v_cancelled,
      'already_checked_in', v_already_used,
      'needs_manual_review', v_needs_review,
      'recovery_mode', v_recovery
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'chargeback_case_id', v_case_id,
    'receivable_id', v_recv.id,
    'company_id', v_company_id,
    'manager_user_id', v_recv.manager_user_id,
    'manager_net_amount', round(v_manager_net, 2),
    'platform_fee_amount', round(v_platform_fee, 2),
    'gross_amount', v_gross,
    'tickets_cancelled_count', v_cancelled,
    'already_checked_in', COALESCE(v_already_used, false),
    'needs_manual_review', v_needs_review,
    'debt_id', v_debt_id,
    'recovery_mode', v_recovery,
    'mp_status', v_mp_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_ticket_chargeback_debts_to_payout(
  p_company_id UUID,
  p_payout_batch_id UUID,
  p_available_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC(12, 2);
  v_applied_total NUMERIC(12, 2) := 0;
  v_row RECORD;
  v_apply NUMERIC(12, 2);
  v_open_due NUMERIC(12, 2);
BEGIN
  v_remaining := round(greatest(COALESCE(p_available_amount, 0), 0), 2);
  IF p_company_id IS NULL OR p_payout_batch_id IS NULL OR v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT d.id, d.amount_due, d.amount_applied
    FROM public.manager_ticket_chargeback_debt d
    WHERE d.company_id = p_company_id
      AND d.status IN ('open', 'partial')
      AND d.recovery_mode = 'credit_settlement_offset'
    ORDER BY d.created_at ASC, d.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_open_due := round(v_row.amount_due - v_row.amount_applied, 2);
    IF v_open_due <= 0 THEN
      UPDATE public.manager_ticket_chargeback_debt
      SET status = 'settled', settled_at = timezone('utc'::text, now()), updated_at = timezone('utc'::text, now())
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    v_apply := round(least(v_open_due, v_remaining), 2);
    IF v_apply <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.manager_ticket_chargeback_debt_applications (debt_id, payout_batch_id, amount)
    VALUES (v_row.id, p_payout_batch_id, v_apply);

    UPDATE public.manager_ticket_chargeback_debt
    SET
      amount_applied = round(amount_applied + v_apply, 2),
      status = CASE WHEN round(amount_applied + v_apply, 2) >= amount_due THEN 'settled' ELSE 'partial' END,
      settled_at = CASE WHEN round(amount_applied + v_apply, 2) >= amount_due THEN timezone('utc'::text, now()) ELSE settled_at END,
      payment_method = COALESCE(payment_method, 'credit_offset'),
      payment_reference = COALESCE(payment_reference, 'batch:' || p_payout_batch_id::text),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_row.id;

    v_applied_total := round(v_applied_total + v_apply, 2);
    v_remaining := round(v_remaining - v_apply, 2);
  END LOOP;

  RETURN v_applied_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_ticket_chargeback_debt_manual_payment(
  p_debt_id UUID,
  p_amount NUMERIC DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'pix',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt public.manager_ticket_chargeback_debt%ROWTYPE;
  v_method TEXT;
  v_apply NUMERIC(12, 2);
  v_open NUMERIC(12, 2);
  v_ref TEXT;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master pode registrar recebimento de chargeback.';
  END IF;
  IF p_debt_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Parametros invalidos.';
  END IF;

  SELECT * INTO v_debt FROM public.manager_ticket_chargeback_debt WHERE id = p_debt_id FOR UPDATE;
  IF v_debt.id IS NULL THEN
    RAISE EXCEPTION 'Divida nao encontrada.';
  END IF;
  IF v_debt.status NOT IN ('open', 'partial') THEN
    RAISE EXCEPTION 'Divida nao esta em aberto (status %).', v_debt.status;
  END IF;
  IF v_debt.recovery_mode <> 'manual_pix' THEN
    RAISE EXCEPTION 'Esta divida e abatida automaticamente no repasse de credito (nao use baixa PIX manual).';
  END IF;

  v_method := lower(COALESCE(NULLIF(trim(p_payment_method), ''), 'pix'));
  IF v_method NOT IN ('pix', 'ted', 'mp_transfer', 'other') THEN
    RAISE EXCEPTION 'Meio de pagamento invalido.';
  END IF;

  v_ref := NULLIF(trim(COALESCE(p_payment_reference, '')), '');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Informe a referencia do comprovante (E2E PIX / TED).';
  END IF;

  v_open := round(v_debt.amount_due - v_debt.amount_applied, 2);
  v_apply := round(COALESCE(NULLIF(p_amount, 0), v_open), 2);
  IF v_apply <= 0 THEN
    RAISE EXCEPTION 'Valor invalido.';
  END IF;
  IF v_apply > v_open THEN
    RAISE EXCEPTION 'Valor maior que o saldo em aberto (R$ %).', to_char(v_open, 'FM999999990.00');
  END IF;

  INSERT INTO public.manager_ticket_chargeback_debt_applications (debt_id, payout_batch_id, amount)
  VALUES (v_debt.id, NULL, v_apply);

  UPDATE public.manager_ticket_chargeback_debt
  SET
    amount_applied = round(amount_applied + v_apply, 2),
    status = CASE WHEN round(amount_applied + v_apply, 2) >= amount_due THEN 'settled' ELSE 'partial' END,
    payment_method = v_method,
    payment_reference = v_ref,
    settlement_notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
    settled_by = p_actor_user_id,
    settled_at = CASE
      WHEN round(amount_applied + v_apply, 2) >= amount_due THEN timezone('utc'::text, now())
      ELSE settled_at
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_debt.id
  RETURNING * INTO v_debt;

  INSERT INTO public.credit_audit_log (
    event_type, subject_user_id, company_id, reference_type, reference_id, summary, payload
  ) VALUES (
    'ticket_chargeback_manual_payment',
    p_actor_user_id,
    v_debt.company_id,
    'manager_ticket_chargeback_debt',
    v_debt.id,
    format('Recebimento chargeback ingresso %s R$ %s — %s', upper(v_method), to_char(v_apply, 'FM999999990.00'), v_ref),
    jsonb_build_object(
      'debt_id', v_debt.id,
      'amount', v_apply,
      'payment_method', v_method,
      'payment_reference', v_ref,
      'status', v_debt.status,
      'amount_remaining', round(v_debt.amount_due - v_debt.amount_applied, 2)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'debt_id', v_debt.id,
    'applied', v_apply,
    'status', v_debt.status,
    'amount_remaining', round(v_debt.amount_due - v_debt.amount_applied, 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.waive_ticket_chargeback_debt(
  p_debt_id UUID,
  p_reason TEXT,
  p_actor_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt public.manager_ticket_chargeback_debt%ROWTYPE;
  v_reason TEXT;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master pode perdoar divida.';
  END IF;
  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF p_debt_id IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe a divida e o motivo da baixa.';
  END IF;

  SELECT * INTO v_debt FROM public.manager_ticket_chargeback_debt WHERE id = p_debt_id FOR UPDATE;
  IF v_debt.id IS NULL THEN
    RAISE EXCEPTION 'Divida nao encontrada.';
  END IF;
  IF v_debt.status NOT IN ('open', 'partial') THEN
    RAISE EXCEPTION 'Divida nao esta em aberto.';
  END IF;

  UPDATE public.manager_ticket_chargeback_debt
  SET
    status = 'waived',
    waive_reason = left(v_reason, 2000),
    waived_at = timezone('utc'::text, now()),
    waived_by = p_actor_user_id,
    settled_at = timezone('utc'::text, now()),
    settled_by = p_actor_user_id,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_debt_id
  RETURNING * INTO v_debt;

  INSERT INTO public.credit_audit_log (
    event_type, subject_user_id, company_id, reference_type, reference_id, summary, payload
  ) VALUES (
    'ticket_chargeback_debt_waived',
    p_actor_user_id,
    v_debt.company_id,
    'manager_ticket_chargeback_debt',
    v_debt.id,
    left('Perdao chargeback ingresso: ' || v_reason, 500),
    jsonb_build_object('debt_id', v_debt.id, 'reason', v_reason, 'amount_due', v_debt.amount_due)
  );

  RETURN jsonb_build_object('ok', true, 'debt_id', v_debt.id, 'status', 'waived');
END;
$$;

REVOKE ALL ON FUNCTION public.register_ticket_chargeback_debt_manual_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waive_ticket_chargeback_debt(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_ticket_chargeback_debt_manual_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waive_ticket_chargeback_debt(UUID, TEXT, UUID) TO authenticated;
