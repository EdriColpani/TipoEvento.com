-- Correção crítica: notificação "approved" do Mercado Pago era descartada.
--
-- Em PIX o MP envia várias notificações para o mesmo payment_id. A primeira
-- chega como "pending" e o job é concluído (nada a fazer). Quando o cliente
-- efetivamente paga, o MP reenvia o mesmo payment_id como "approved", mas o
-- ON CONFLICT mantinha status='completed', o webhook recebia
-- already_completed=true e devolvia 200 sem processar a aprovação.
-- Resultado: cliente pagou, ingresso não foi emitido e o checkout expirou.

CREATE OR REPLACE FUNCTION public.enqueue_payment_webhook_job(
  p_mp_payment_id TEXT,
  p_external_reference TEXT,
  p_event_id UUID,
  p_payment_status TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_status TEXT;
BEGIN
  INSERT INTO public.payment_webhook_jobs (
    mp_payment_id,
    external_reference,
    event_id,
    payment_status,
    payload,
    status
  ) VALUES (
    trim(p_mp_payment_id),
    NULLIF(trim(p_external_reference), ''),
    p_event_id,
    NULLIF(trim(p_payment_status), ''),
    p_payload,
    'pending'
  )
  ON CONFLICT (mp_payment_id) DO UPDATE
  SET
    payment_status = EXCLUDED.payment_status,
    payload = EXCLUDED.payload,
    event_id = COALESCE(EXCLUDED.event_id, payment_webhook_jobs.event_id),
    -- só continua concluído se o MP reenviou exatamente o mesmo status já processado
    status = CASE
      WHEN payment_webhook_jobs.status = 'completed'
       AND payment_webhook_jobs.payment_status IS NOT DISTINCT FROM EXCLUDED.payment_status
        THEN 'completed'
      ELSE 'pending'
    END,
    attempts = CASE
      WHEN payment_webhook_jobs.status IN ('completed', 'failed')
       AND payment_webhook_jobs.payment_status IS DISTINCT FROM EXCLUDED.payment_status
        THEN 0
      ELSE payment_webhook_jobs.attempts
    END,
    processed_at = CASE
      WHEN payment_webhook_jobs.status = 'completed'
       AND payment_webhook_jobs.payment_status IS NOT DISTINCT FROM EXCLUDED.payment_status
        THEN payment_webhook_jobs.processed_at
      ELSE NULL
    END,
    -- não solta o lock de um job em processamento, para não duplicar execução
    locked_at = CASE
      WHEN payment_webhook_jobs.status = 'processing' THEN payment_webhook_jobs.locked_at
      ELSE NULL
    END,
    last_error = NULL
  RETURNING id, status INTO v_id, v_status;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_id,
    'status', v_status,
    'already_completed', v_status = 'completed'
  );
END;
$$;

-- A fila só pode ser manipulada pelo backend. Com anon/authenticated liberados,
-- qualquer portador da anon key podia injetar um pagamento "approved" forjado e
-- receber ingresso sem pagar, já que o worker repassa o payload ao webhook interno.
REVOKE ALL ON FUNCTION public.enqueue_payment_webhook_job(TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_payment_webhook_job(TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.claim_payment_webhook_jobs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_webhook_jobs(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.complete_payment_webhook_job(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_payment_webhook_job(UUID, BOOLEAN, TEXT) TO service_role;

-- Blindagem contra comissão duplicada: cada transação pode ter no máximo uma
-- linha de comissão da plataforma e uma linha de líquido do organizador.
CREATE UNIQUE INDEX IF NOT EXISTS financial_splits_platform_unique
  ON public.financial_splits (transaction_id)
  WHERE platform_amount > 0;

CREATE UNIQUE INDEX IF NOT EXISTS financial_splits_manager_unique
  ON public.financial_splits (transaction_id)
  WHERE manager_amount > 0;
