-- Auditoria de eventos de pagamento (hardening de reconciliação)
CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- webhook | manual_check | system
  payment_status TEXT,
  receivable_status TEXT,
  payment_status_detail TEXT,
  mp_payment_id TEXT,
  mp_preference_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_transaction_id
  ON public.payment_events(transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
  ON public.payment_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_source
  ON public.payment_events(source);

