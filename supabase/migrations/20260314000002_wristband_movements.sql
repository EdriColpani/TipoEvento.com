-- Tabela analítica de movimentações por pulseira/ingresso
CREATE TABLE IF NOT EXISTS public.wristband_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    wristband_id UUID NOT NULL REFERENCES public.wristbands(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES public.validation_api_keys(id) ON DELETE SET NULL,
    validation_log_id UUID REFERENCES public.validation_logs(id) ON DELETE SET NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('entry', 'exit')),
    validated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.wristband_movements IS 'Histórico analítico de entradas e saídas por pulseira/ingresso.';
COMMENT ON COLUMN public.wristband_movements.movement_type IS 'entry = entrada no evento; exit = saída do evento.';

-- Índices para consultas analíticas comuns
CREATE INDEX IF NOT EXISTS wristband_movements_event_id_idx
    ON public.wristband_movements (event_id);

CREATE INDEX IF NOT EXISTS wristband_movements_wristband_id_idx
    ON public.wristband_movements (wristband_id);

CREATE INDEX IF NOT EXISTS wristband_movements_validated_at_idx
    ON public.wristband_movements (validated_at);

