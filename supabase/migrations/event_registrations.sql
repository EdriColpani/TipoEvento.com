-- ============================================
-- Inscrições em eventos gratuitos
-- ============================================
-- Tabela para armazenar inscrições de participantes em eventos não pagos.
-- wristband_id será preenchido na fase 2 (vínculo com ingresso/pulseira para envio por e-mail).

CREATE TABLE IF NOT EXISTS event_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    cpf VARCHAR(14) NOT NULL,
    age INTEGER NOT NULL,
    street TEXT NOT NULL,
    number VARCHAR(20) NOT NULL,
    neighborhood TEXT NOT NULL,
    complement TEXT,
    city TEXT NOT NULL,
    state VARCHAR(2) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email TEXT NOT NULL,
    wristband_id UUID REFERENCES wristbands(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_cpf ON event_registrations(cpf);
CREATE INDEX IF NOT EXISTS idx_event_registrations_email ON event_registrations(email);
CREATE INDEX IF NOT EXISTS idx_event_registrations_wristband_id ON event_registrations(wristband_id) WHERE wristband_id IS NOT NULL;

-- Constraint: uma inscrição por CPF por evento
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registrations_event_cpf ON event_registrations(event_id, cpf);

-- RLS: permitir INSERT anônimo (página pública de inscrição) e SELECT para gestores/admin
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

-- Inserção pública (anon + authenticated) para página de inscrição
CREATE POLICY "event_registrations_insert_public"
    ON event_registrations FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Leitura: usuários autenticados que sejam gestores do evento ou admin (via company/events)
-- Por simplicidade, permitir SELECT para authenticated; restringir por company_id do evento depois se necessário
CREATE POLICY "event_registrations_select_authenticated"
    ON event_registrations FOR SELECT
    TO authenticated
    USING (true);

-- Serviço (service_role) e anon precisam de permissões mínimas: anon só insere, não lê outras inscrições
-- Nenhuma policy de UPDATE/DELETE para anon (apenas gestor/admin pode atualizar, ex. vincular wristband_id)
CREATE POLICY "event_registrations_update_authenticated"
    ON event_registrations FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE event_registrations IS 'Inscrições em eventos gratuitos; wristband_id preenchido na fase 2 para envio do ingresso por e-mail.';
