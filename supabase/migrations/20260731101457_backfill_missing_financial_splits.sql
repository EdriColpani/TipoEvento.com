-- Recupera financial_splits de recebíveis pagos que ficaram sem split.
-- Causa conhecida: PIX aprovado fora do webhook (check-payment-status marcava 'paid'
-- sem gravar o split, quando o Mercado Pago não reenviava a notificação de approved).
-- Idempotente: ignora recebíveis que já têm split e compras pagas com crédito EventFest
-- (essas têm split próprio em credit_financial_splits).

CREATE OR REPLACE FUNCTION public.admin_backfill_missing_financial_splits(
  p_receivable_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_pct NUMERIC(6, 2);
  v_gross NUMERIC(14, 2);
  v_mp_fee NUMERIC(14, 2);
  v_platform NUMERIC(14, 2);
  v_manager NUMERIC(14, 2);
  v_items JSONB := '[]'::jsonb;
  v_count INTEGER := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.user_is_admin_master_for_rls()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  FOR v_row IN
    SELECT
      r.id,
      r.event_id,
      r.manager_user_id,
      r.gross_amount,
      r.total_value,
      r.mp_fee_amount,
      r.platform_fee_amount,
      r.net_amount_after_mp,
      r.settlement_channel,
      e.applied_percentage
    FROM public.receivables r
    INNER JOIN public.events e ON e.id = r.event_id
    WHERE (p_receivable_id IS NULL OR r.id = p_receivable_id)
      AND (
        COALESCE(r.status, '') = 'paid'
        OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
      )
      AND COALESCE(r.payment_gateway_id, '') NOT LIKE 'eventfest_credit:%'
      AND r.manager_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.financial_splits fs WHERE fs.transaction_id = r.id
      )
  LOOP
    v_gross := round(COALESCE(v_row.gross_amount, v_row.total_value, 0), 2);
    CONTINUE WHEN v_gross <= 0;

    v_pct := COALESCE(v_row.applied_percentage, 0);
    v_mp_fee := round(COALESCE(v_row.mp_fee_amount, 0), 2);
    v_platform := round(
      COALESCE(NULLIF(v_row.platform_fee_amount, 0), v_gross * (v_pct / 100.0)),
      2
    );

    -- No repasse D+1 quem recebe do MP é a plataforma; net_amount_after_mp é o líquido
    -- da EventFest, então o líquido do gestor tem que ser recalculado.
    IF v_row.settlement_channel = 'manual_d1' THEN
      v_manager := greatest(round(v_gross - v_mp_fee - v_platform, 2), 0);
    ELSE
      v_manager := greatest(
        round(COALESCE(v_row.net_amount_after_mp, v_gross - v_mp_fee - v_platform), 2),
        0
      );
    END IF;

    INSERT INTO public.financial_splits (
      transaction_id, event_id, manager_user_id,
      platform_amount, manager_amount, total_amount, applied_percentage
    ) VALUES
      (v_row.id, v_row.event_id, v_row.manager_user_id, 0, v_manager, v_gross, v_pct),
      (v_row.id, v_row.event_id, v_row.manager_user_id, v_platform, 0, v_gross, v_pct);

    v_count := v_count + 1;
    v_items := v_items || jsonb_build_object(
      'receivable_id', v_row.id,
      'gross_amount', v_gross,
      'platform_amount', v_platform,
      'manager_amount', v_manager,
      'applied_percentage', v_pct
    );
  END LOOP;

  RETURN jsonb_build_object('backfilled', v_count, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_missing_financial_splits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_backfill_missing_financial_splits(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_backfill_missing_financial_splits(UUID) IS
  'Admin/service: recria financial_splits de recebíveis pagos sem split (idempotente).';
