-- ============================================
-- Tabela de Contratos de Eventos
-- ============================================

-- Cria a tabela event_contracts se não existir
CREATE TABLE IF NOT EXISTS event_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version VARCHAR(20) NOT NULL UNIQUE, -- Ex: "1.0", "2.0"
    title VARCHAR(255) NOT NULL,        -- Título do contrato, Ex: "Termos de Uso da Plataforma EventoFest"
    content TEXT NOT NULL,              -- O conteúdo completo do contrato (HTML ou Markdown)
    is_active BOOLEAN DEFAULT FALSE,    -- Apenas um contrato ativo por vez
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Usuário Admin Master que criou/editou
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cria índice para melhor performance
CREATE INDEX IF NOT EXISTS idx_event_contracts_version ON event_contracts(version);
CREATE INDEX IF NOT EXISTS idx_event_contracts_is_active ON event_contracts(is_active) WHERE is_active IS TRUE;

-- ============================================
-- Função para atualizar updated_at automaticamente
-- ============================================

CREATE OR REPLACE FUNCTION update_event_contracts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_event_contracts_updated_at ON event_contracts;
CREATE TRIGGER trigger_update_event_contracts_updated_at
    BEFORE UPDATE ON event_contracts
    FOR EACH ROW
    EXECUTE FUNCTION update_event_contracts_updated_at();

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Habilita RLS
ALTER TABLE event_contracts ENABLE ROW LEVEL SECURITY;

-- Policy para event_contracts: Apenas Admin Master (tipo_usuario_id = 1) pode ler/escrever
CREATE POLICY "Admin Master can manage event_contracts"
    ON event_contracts FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.tipo_usuario_id = 1
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.tipo_usuario_id = 1
        )
    );

-- ============================================
-- Dados iniciais (opcional)
-- ============================================

-- Insere um contrato inicial se a tabela estiver vazia
INSERT INTO event_contracts (version, title, content, is_active)
SELECT '1.0', 'Termos de Uso da Plataforma EventoFest', '<h2>Termos de Uso</h2><p>Bem-vindo à plataforma EventoFest. Ao criar um evento, você concorda com os seguintes termos e condições...</p><p>A comissão para venda de ingressos é de X% conforme as faixas de comissão ativas no momento da criação do evento.</p>', TRUE
WHERE NOT EXISTS (SELECT 1 FROM event_contracts WHERE version = '1.0');

