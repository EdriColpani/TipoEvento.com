-- Portaria: ciclo entrada/saída por ASSENTO (wristband_analytics), não por lote.
-- Compra de N ingressos gera N analytics no mesmo wristband_id; sem analytics_id
-- a 1ª entrada contaminava os demais QRs.

ALTER TABLE public.wristband_movements
  ADD COLUMN IF NOT EXISTS analytics_id UUID REFERENCES public.wristband_analytics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wristband_movements_analytics_validated
  ON public.wristband_movements (analytics_id, validated_at DESC)
  WHERE analytics_id IS NOT NULL;

COMMENT ON COLUMN public.wristband_movements.analytics_id IS
  'Assento/ingresso individual (wristband_analytics). Ciclo entrada↔saída deve usar esta coluna; wristband_id permanece como lote/tipo.';
