-- ============================================
-- Sistema de Controle de Acesso para App de Validação
-- ============================================

-- Tabela para armazenar chaves de API dos colaboradores/operadores
CREATE TABLE IF NOT EXISTS validation_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,                    -- Nome do colaborador/operador
    api_key VARCHAR(255) NOT NULL UNIQUE,         -- Chave de acesso única (gerada automaticamente)
    api_key_hash TEXT NOT NULL,                   -- Hash da chave para validação segura
    event_id UUID REFERENCES events(id) ON DELETE CASCADE, -- Evento específico (NULL = todos os eventos)
    is_active BOOLEAN DEFAULT TRUE,                -- Se a chave está ativa
    expires_at TIMESTAMP WITH TIME ZONE NULL,      -- Data de expiração (NULL = sem expiração)
    last_used_at TIMESTAMP WITH TIME ZONE NULL,    -- Última vez que foi usada
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL, -- Gestor que criou a chave
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_validation_api_keys_api_key ON validation_api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_validation_api_keys_api_key_hash ON validation_api_keys(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_validation_api_keys_event_id ON validation_api_keys(event_id);
CREATE INDEX IF NOT EXISTS idx_validation_api_keys_is_active ON validation_api_keys(is_active) WHERE is_active IS TRUE;
CREATE INDEX IF NOT EXISTS idx_validation_api_keys_created_by ON validation_api_keys(created_by);

-- Tabela para logs de validação de ingressos
CREATE TABLE IF NOT EXISTS validation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES validation_api_keys(id) ON DELETE SET NULL, -- Chave usada para validar
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,                -- Evento validado
    wristband_id UUID REFERENCES wristbands(id) ON DELETE SET NULL,        -- Pulseira validada
    wristband_code VARCHAR(255) NOT NULL,                                   -- Código da pulseira validada
    validation_type VARCHAR(50) NOT NULL,                                   -- 'entry' ou 'exit'
    validation_status VARCHAR(50) NOT NULL,                                 -- 'success', 'invalid', 'already_used', 'expired', 'not_paid'
    validation_message TEXT,                                                 -- Mensagem de erro ou sucesso
    validated_by_name VARCHAR(255),                                          -- Nome do operador que validou
    client_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,        -- Cliente dono do ingresso
    ip_address INET,                                                         -- IP de onde veio a validação
    user_agent TEXT,                                                         -- User agent do dispositivo
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para logs
CREATE INDEX IF NOT EXISTS idx_validation_logs_api_key_id ON validation_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_validation_logs_event_id ON validation_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_validation_logs_wristband_id ON validation_logs(wristband_id);
CREATE INDEX IF NOT EXISTS idx_validation_logs_wristband_code ON validation_logs(wristband_code);
CREATE INDEX IF NOT EXISTS idx_validation_logs_validation_status ON validation_logs(validation_status);
CREATE INDEX IF NOT EXISTS idx_validation_logs_created_at ON validation_logs(created_at DESC);

-- ============================================
-- Função para gerar API Key única
-- ============================================

CREATE OR REPLACE FUNCTION generate_validation_api_key()
RETURNS TEXT AS $$
DECLARE
    new_key TEXT;
    key_hash TEXT;
    key_exists BOOLEAN;
BEGIN
    LOOP
        -- Gera uma chave aleatória de 32 caracteres (base64url safe)
        new_key := encode(gen_random_bytes(24), 'base64');
        new_key := replace(replace(new_key, '+', '-'), '/', '_');
        new_key := rtrim(new_key, '=');
        
        -- Gera o hash da chave
        key_hash := encode(digest(new_key, 'sha256'), 'hex');
        
        -- Verifica se o hash já existe
        SELECT EXISTS(
            SELECT 1 FROM validation_api_keys 
            WHERE api_key_hash = key_hash
        ) INTO key_exists;
        
        EXIT WHEN NOT key_exists;
    END LOOP;
    
    RETURN new_key;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Função para atualizar updated_at automaticamente
-- ============================================

CREATE OR REPLACE FUNCTION update_validation_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_validation_api_keys_updated_at ON validation_api_keys;
CREATE TRIGGER trigger_update_validation_api_keys_updated_at
    BEFORE UPDATE ON validation_api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_validation_api_keys_updated_at();

-- ============================================
-- Função para atualizar last_used_at quando a chave é usada
-- ============================================

CREATE OR REPLACE FUNCTION update_api_key_last_used()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.api_key_id IS NOT NULL THEN
        UPDATE validation_api_keys
        SET last_used_at = NOW()
        WHERE id = NEW.api_key_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar last_used_at
DROP TRIGGER IF EXISTS trigger_update_api_key_last_used ON validation_logs;
CREATE TRIGGER trigger_update_api_key_last_used
    AFTER INSERT ON validation_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_api_key_last_used();

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Habilita RLS
ALTER TABLE validation_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_logs ENABLE ROW LEVEL SECURITY;

-- Policies para validation_api_keys:
-- Gestores PRO podem gerenciar chaves de eventos da mesma empresa
-- Verifica company_id através de user_companies e events
CREATE POLICY "Managers can view their validation keys"
    ON validation_api_keys FOR SELECT
    USING (
        -- Verifica se o evento da chave pertence à mesma empresa do usuário logado
        EXISTS (
            SELECT 1 FROM events
            INNER JOIN user_companies uc ON uc.company_id = events.company_id
            WHERE events.id = validation_api_keys.event_id
            AND uc.user_id = auth.uid()
            AND uc.is_primary = true
        )
    );

CREATE POLICY "Managers can create validation keys"
    ON validation_api_keys FOR INSERT
    WITH CHECK (
        created_by = auth.uid() AND
        -- Verifica se o evento pertence à mesma empresa do usuário logado
        EXISTS (
            SELECT 1 FROM events
            INNER JOIN user_companies uc ON uc.company_id = events.company_id
            WHERE events.id = validation_api_keys.event_id
            AND uc.user_id = auth.uid()
            AND uc.is_primary = true
        )
    );

CREATE POLICY "Managers can update their validation keys"
    ON validation_api_keys FOR UPDATE
    USING (
        -- Verifica se o evento da chave pertence à mesma empresa do usuário logado
        EXISTS (
            SELECT 1 FROM events
            INNER JOIN user_companies uc ON uc.company_id = events.company_id
            WHERE events.id = validation_api_keys.event_id
            AND uc.user_id = auth.uid()
            AND uc.is_primary = true
        )
    )
    WITH CHECK (
        -- Verifica se o evento (novo ou existente) pertence à mesma empresa do usuário logado
        EXISTS (
            SELECT 1 FROM events
            INNER JOIN user_companies uc ON uc.company_id = events.company_id
            WHERE events.id = validation_api_keys.event_id
            AND uc.user_id = auth.uid()
            AND uc.is_primary = true
        )
    );

CREATE POLICY "Managers can delete their validation keys"
    ON validation_api_keys FOR DELETE
    USING (
        -- Verifica se o evento da chave pertence à mesma empresa do usuário logado
        EXISTS (
            SELECT 1 FROM events
            INNER JOIN user_companies uc ON uc.company_id = events.company_id
            WHERE events.id = validation_api_keys.event_id
            AND uc.user_id = auth.uid()
            AND uc.is_primary = true
        )
    );

-- Admin Master pode ver todas as chaves
CREATE POLICY "Admin Master can manage all validation keys"
    ON validation_api_keys FOR ALL
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

-- Policies para validation_logs:
-- Gestores podem ver logs de eventos da mesma empresa
CREATE POLICY "Managers can view validation logs"
    ON validation_logs FOR SELECT
    USING (
        -- Verifica se o evento do log pertence à mesma empresa do usuário logado
        EXISTS (
            SELECT 1 FROM events
            INNER JOIN user_companies uc ON uc.company_id = events.company_id
            WHERE events.id = validation_logs.event_id
            AND uc.user_id = auth.uid()
            AND uc.is_primary = true
        )
    );

-- Admin Master pode ver todos os logs
CREATE POLICY "Admin Master can view all validation logs"
    ON validation_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.tipo_usuario_id = 1
        )
    );

-- A Edge Function (validate-ticket) pode inserir logs usando service role
-- (não precisa de policy, pois usa service role key)

