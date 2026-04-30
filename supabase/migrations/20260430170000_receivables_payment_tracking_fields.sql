-- Fase 1: rastreabilidade de pagamento em receivables
-- Mantém compatibilidade com fluxo atual e adiciona campos para auditoria/financeiro.

ALTER TABLE IF EXISTS public.receivables
ADD COLUMN IF NOT EXISTS payment_status TEXT,
ADD COLUMN IF NOT EXISTS mp_payment_id TEXT,
ADD COLUMN IF NOT EXISTS mp_preference_id TEXT,
ADD COLUMN IF NOT EXISTS mp_status_detail TEXT,
ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS mp_fee_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS net_amount_after_mp NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_receivables_payment_status
ON public.receivables(payment_status);

CREATE INDEX IF NOT EXISTS idx_receivables_mp_payment_id
ON public.receivables(mp_payment_id);

CREATE INDEX IF NOT EXISTS idx_receivables_mp_preference_id
ON public.receivables(mp_preference_id);
