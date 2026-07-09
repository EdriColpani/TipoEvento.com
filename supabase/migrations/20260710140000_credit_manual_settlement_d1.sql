-- Liquidação manual D+1: repasse ao gestor via TED/PIX pelo Admin (sem MP automático).

-- 1) Retenção D+1
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'system_billing_settings'
  ) THEN
    UPDATE public.system_billing_settings
    SET credit_settlement_retention_days = 1
    WHERE id = 1;
  END IF;
END $$;

-- 2) Campos de auditoria no lote de pagamento manual
ALTER TABLE public.credit_payout_batches
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS registered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_payout_batches_payment_method_check'
  ) THEN
    ALTER TABLE public.credit_payout_batches
      ADD CONSTRAINT credit_payout_batches_payment_method_check
      CHECK (
        payment_method IS NULL
        OR payment_method IN ('pix', 'ted', 'mp_transfer', 'other')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.credit_payout_batches.payment_method IS
  'Meio usado pelo Admin Master para liquidar repasses (pix, ted, etc.).';
COMMENT ON COLUMN public.credit_payout_batches.payment_reference IS
  'Comprovante / ID da transação bancária registrada pelo Admin.';

-- 3) Restaurar gatilho de settlement (sem credit_mp_disbursements automático)
CREATE OR REPLACE FUNCTION public.credit_settlement_from_split()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention INTEGER;
BEGIN
  IF NEW.manager_amount IS NULL OR NEW.manager_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_retention := public.get_credit_settlement_retention_days();

  INSERT INTO public.manager_credit_settlement_ledger (
    company_id,
    spend_order_id,
    split_id,
    manager_amount,
    status,
    release_at
  ) VALUES (
    NEW.receiver_company_id,
    NEW.spend_order_id,
    NEW.id,
    NEW.manager_amount,
    'pending',
    timezone('utc'::text, now()) + make_interval(days => v_retention)
  )
  ON CONFLICT (split_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_disbursement_from_split ON public.credit_financial_splits;
DROP TRIGGER IF EXISTS trg_credit_settlement_from_split ON public.credit_financial_splits;

CREATE TRIGGER trg_credit_settlement_from_split
  AFTER INSERT ON public.credit_financial_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_settlement_from_split();

-- 4) Normalizar registros legados do fluxo MP instantâneo
UPDATE public.manager_credit_settlement_ledger m
SET
  status = CASE
    WHEN m.status IN ('disbursed', 'paid') AND m.paid_at IS NOT NULL THEN 'paid'
    WHEN m.status IN ('pending_mp', 'disbursement_failed') THEN 'pending'
    ELSE m.status
  END,
  release_at = CASE
    WHEN m.status IN ('pending_mp', 'disbursement_failed')
      THEN GREATEST(m.created_at + interval '1 day', timezone('utc'::text, now()))
    ELSE m.release_at
  END,
  updated_at = timezone('utc'::text, now())
WHERE m.status IN ('pending_mp', 'disbursement_failed', 'disbursed');

UPDATE public.credit_mp_disbursements
SET
  status = 'failed',
  mp_error = COALESCE(mp_error, 'Fluxo MP automático descontinuado — liquidação manual D+1.'),
  updated_at = timezone('utc'::text, now())
WHERE status IN ('pending', 'processing');

-- Liberar itens com retenção vencida
SELECT public.process_credit_settlement_releases();

-- 5) Lista enriquecida — gestor
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
      ce.establishment_kind
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

-- 6) Admin — lista detalhada + totais
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
      ce.establishment_kind,
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

-- 7) Admin — agrupamento por empresa / evento / estabelecimento
CREATE OR REPLACE FUNCTION public.list_admin_credit_settlements_grouped(
  p_status TEXT DEFAULT 'released'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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

  SELECT COALESCE(jsonb_agg(company_row ORDER BY company_row->>'company_name'), '[]'::jsonb)
  INTO v_companies
  FROM (
    SELECT jsonb_build_object(
      'company_id', c.id,
      'company_name', c.corporate_name,
      'pending_retention_total', COALESCE(SUM(CASE WHEN m.status = 'pending' THEN m.manager_amount ELSE 0 END), 0),
      'awaiting_payment_total', COALESCE(SUM(CASE WHEN m.status = 'released' THEN m.manager_amount ELSE 0 END), 0),
      'paid_total', COALESCE(SUM(CASE WHEN m.status = 'paid' THEN m.manager_amount ELSE 0 END), 0),
      'groups', (
        SELECT COALESCE(jsonb_agg(grp ORDER BY grp->>'group_label'), '[]'::jsonb)
        FROM (
          SELECT jsonb_build_object(
            'group_type', CASE
              WHEN o.receiver_event_id IS NOT NULL THEN 'event'
              WHEN o.receiver_establishment_id IS NOT NULL THEN 'establishment'
              ELSE 'company'
            END,
            'group_key', COALESCE(o.receiver_event_id::text, o.receiver_establishment_id::text, c.id::text),
            'group_label', COALESCE(e.title, ce.name, c.corporate_name),
            'awaiting_payment_total', COALESCE(SUM(CASE WHEN m2.status = 'released' THEN m2.manager_amount ELSE 0 END), 0),
            'item_count', COUNT(*) FILTER (WHERE m2.status = COALESCE(p_status, m2.status)),
            'items', (
              SELECT COALESCE(jsonb_agg(row_to_json(item_row)::jsonb ORDER BY item_row.spend_at ASC), '[]'::jsonb)
              FROM (
                SELECT
                  m3.id,
                  m3.spend_order_id,
                  m3.manager_amount,
                  m3.status,
                  m3.release_at,
                  m3.released_at,
                  s3.gross_amount,
                  s3.platform_amount,
                  o3.public_description AS spend_description,
                  o3.created_at AS spend_at,
                  o3.channel
                FROM public.manager_credit_settlement_ledger m3
                INNER JOIN public.credit_spend_orders o3 ON o3.id = m3.spend_order_id
                INNER JOIN public.credit_financial_splits s3 ON s3.id = m3.split_id
                WHERE m3.company_id = c.id
                  AND COALESCE(o3.receiver_event_id::text, o3.receiver_establishment_id::text, c.id::text)
                    = COALESCE(o.receiver_event_id::text, o.receiver_establishment_id::text, c.id::text)
                  AND (p_status IS NULL OR m3.status = p_status)
              ) item_row
            )
          ) AS grp
          FROM public.manager_credit_settlement_ledger m2
          INNER JOIN public.credit_spend_orders o ON o.id = m2.spend_order_id
          LEFT JOIN public.events e ON e.id = o.receiver_event_id
          LEFT JOIN public.credit_establishments ce ON ce.id = o.receiver_establishment_id
          WHERE m2.company_id = c.id
            AND (p_status IS NULL OR m2.status = p_status)
          GROUP BY
            CASE
              WHEN o.receiver_event_id IS NOT NULL THEN 'event'
              WHEN o.receiver_establishment_id IS NOT NULL THEN 'establishment'
              ELSE 'company'
            END,
            COALESCE(o.receiver_event_id::text, o.receiver_establishment_id::text, c.id::text),
            COALESCE(e.title, ce.name, c.corporate_name)
        ) g
      )
    ) AS company_row
    FROM public.companies c
    INNER JOIN public.manager_credit_settlement_ledger m ON m.company_id = c.id
    WHERE p_status IS NULL OR m.status = p_status
    GROUP BY c.id, c.corporate_name
  ) companies;

  RETURN jsonb_build_object('companies', v_companies, 'settlement_mode', 'manual_d1');
END;
$$;

-- 8) Registrar pagamento manual (Admin Master) — baixa + auditoria
CREATE OR REPLACE FUNCTION public.register_admin_credit_settlement_payment(
  p_company_id UUID,
  p_settlement_ids UUID[] DEFAULT NULL,
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
  v_batch_id UUID;
  v_total NUMERIC(12, 2);
  v_count INTEGER;
  v_ref TEXT;
  v_method TEXT;
  v_row RECORD;
  v_company_name TEXT;
  v_event_title TEXT;
BEGIN
  IF p_company_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master pode registrar liquidação manual.';
  END IF;

  v_method := lower(COALESCE(NULLIF(trim(p_payment_method), ''), 'pix'));
  IF v_method NOT IN ('pix', 'ted', 'mp_transfer', 'other') THEN
    RAISE EXCEPTION 'Meio de pagamento inválido.';
  END IF;

  PERFORM public.process_credit_settlement_releases();

  IF p_settlement_ids IS NOT NULL AND COALESCE(array_length(p_settlement_ids, 1), 0) > 0 THEN
    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_total, v_count
    FROM public.manager_credit_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released'
      AND id = ANY (p_settlement_ids);
  ELSE
    SELECT COALESCE(SUM(manager_amount), 0), COUNT(*)
    INTO v_total, v_count
    FROM public.manager_credit_settlement_ledger
    WHERE company_id = p_company_id
      AND status = 'released';
  END IF;

  IF v_count = 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Nenhum repasse liberado (D+1) disponível para pagamento.';
  END IF;

  v_ref := COALESCE(NULLIF(trim(p_payment_reference), ''), 'EF-MANUAL-' || gen_random_uuid()::text);

  SELECT corporate_name INTO v_company_name FROM public.companies WHERE id = p_company_id;

  INSERT INTO public.credit_payout_batches (
    company_id,
    manager_user_id,
    total_amount,
    settlement_count,
    status,
    mp_payout_reference,
    payment_method,
    payment_reference,
    registered_by,
    notes,
    paid_at
  ) VALUES (
    p_company_id,
    p_actor_user_id,
    round(v_total, 2),
    v_count,
    'paid',
    v_ref,
    v_method,
    v_ref,
    p_actor_user_id,
    NULLIF(trim(p_notes), ''),
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN
    SELECT m.id, m.spend_order_id, m.split_id, m.manager_amount
    FROM public.manager_credit_settlement_ledger m
    WHERE m.company_id = p_company_id
      AND m.status = 'released'
      AND (
        p_settlement_ids IS NULL
        OR COALESCE(array_length(p_settlement_ids, 1), 0) = 0
        OR m.id = ANY (p_settlement_ids)
      )
  LOOP
    UPDATE public.manager_credit_settlement_ledger
    SET
      status = 'paid',
      paid_at = timezone('utc'::text, now()),
      payout_batch_id = v_batch_id,
      mp_payout_reference = v_ref,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_row.id;

    SELECT e.title INTO v_event_title
    FROM public.credit_spend_orders o
    LEFT JOIN public.events e ON e.id = o.receiver_event_id
    WHERE o.id = v_row.spend_order_id;

    INSERT INTO public.credit_ledger_entries (
      account_user_id,
      entry_type,
      entry_subtype,
      amount,
      balance_after,
      idempotency_key,
      correlation_id,
      receiver_company_id,
      receiver_event_id,
      receiver_establishment_id,
      reference_type,
      reference_id,
      public_description,
      internal_description,
      metadata
    )
    SELECT
      o.client_user_id,
      'spend',
      'spend_allocation_manager',
      0,
      acc.balance_cached,
      'settlement:manager:' || v_row.id::text,
      o.correlation_id,
      o.receiver_company_id,
      o.receiver_event_id,
      o.receiver_establishment_id,
      'credit_settlement',
      v_row.id,
      format(
        E'**Repasse EventFest (liquidação manual)** — R$ %s pagos a %s%s. Ref.: %s (%s).',
        to_char(v_row.manager_amount, 'FM999999990.00'),
        COALESCE(v_company_name, 'empresa parceira'),
        CASE WHEN v_event_title IS NOT NULL THEN format(' — "%s"', v_event_title) ELSE '' END,
        v_ref,
        upper(v_method)
      ),
      format('Manual settlement | settlement %s | batch %s', v_row.id, v_batch_id),
      jsonb_build_object(
        'manager_amount', v_row.manager_amount,
        'payment_method', v_method,
        'payment_reference', v_ref,
        'payout_batch_id', v_batch_id,
        'informational_only', true
      )
    FROM public.credit_spend_orders o
    INNER JOIN public.client_credit_accounts acc ON acc.user_id = o.client_user_id
    WHERE o.id = v_row.spend_order_id
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.credit_audit_log (
    event_type,
    subject_user_id,
    company_id,
    reference_type,
    reference_id,
    summary,
    payload
  ) VALUES (
    'manual_settlement_paid',
    p_actor_user_id,
    p_company_id,
    'credit_payout_batch',
    v_batch_id,
    format('Liquidação manual %s — %s itens — total R$ %s', upper(v_method), v_count, to_char(v_total, 'FM999999990.00')),
    jsonb_build_object(
      'batch_id', v_batch_id,
      'company_id', p_company_id,
      'payment_method', v_method,
      'payment_reference', v_ref,
      'total_amount', round(v_total, 2),
      'settlement_count', v_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'total_amount', round(v_total, 2),
    'settlement_count', v_count,
    'payment_reference', v_ref,
    'payment_method', v_method
  );
END;
$$;

-- 9) Atualizar execute_manager_credit_payout (delega ao registro manual para admin)
CREATE OR REPLACE FUNCTION public.execute_manager_credit_payout(
  p_company_id UUID,
  p_settlement_ids UUID[] DEFAULT NULL,
  p_actor_user_id UUID DEFAULT auth.uid(),
  p_mp_reference TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'pix',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.user_is_admin_master_for_rls() THEN
    RETURN public.register_admin_credit_settlement_payment(
      p_company_id,
      p_settlement_ids,
      COALESCE(p_payment_method, 'pix'),
      COALESCE(p_payment_reference, p_mp_reference),
      p_notes,
      p_actor_user_id
    );
  END IF;

  RAISE EXCEPTION 'Liquidação manual é registrada pelo Admin Master (TED/PIX). Gestor: acompanhe em Repasses pendentes.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_admin_credit_settlements_grouped(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_admin_credit_settlement_payment(UUID, UUID[], TEXT, TEXT, TEXT, UUID) TO authenticated;
