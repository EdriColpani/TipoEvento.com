-- Tabela para registrar o aceite de contratos por usuários e empresas
CREATE TABLE IF NOT EXISTS public.contract_acceptances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- Quem aceitou (se for pessoa física)
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE, -- Qual empresa aceitou (se for jurídica)
    contract_id UUID NOT NULL REFERENCES public.event_contracts(id) ON DELETE CASCADE, -- Qual contrato foi aceito
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Detalhes da versão no momento do aceite para auditoria
    contract_version TEXT NOT NULL, -- Versão do contrato aceito
    contract_type TEXT NOT NULL     -- Tipo do contrato aceito
);

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_user_id ON public.contract_acceptances (user_id);
CREATE INDEX IF NOT EXISTS idx_contract_acceptances_company_id ON public.contract_acceptances (company_id);
CREATE INDEX IF NOT EXISTS idx_contract_acceptances_contract_id ON public.contract_acceptances (contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_acceptances_user_contract_type ON public.contract_acceptances (user_id, contract_type) WHERE user_id IS NOT NULL; -- Apenas 1 aceite por tipo para PF
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_acceptances_company_contract_type ON public.contract_acceptances (company_id, contract_type) WHERE company_id IS NOT NULL; -- Apenas 1 aceite por tipo para PJ

-- RLS para contract_acceptances
ALTER TABLE public.contract_acceptances ENABLE ROW LEVEL SECURITY;

-- Leitura para o próprio usuário/empresa que aceitou ou Admin Master
CREATE POLICY "contract_acceptances_select_self_or_admin"
ON public.contract_acceptances
FOR SELECT
TO authenticated
USING (
  (auth.uid() = user_id) OR
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 1 -- Admin Master
  )
);

-- Inserção: Permitir apenas para o próprio usuário/empresa que está logado (ou Admin Master)
CREATE POLICY "contract_acceptances_insert_self_or_admin"
ON public.contract_acceptances
FOR INSERT
TO authenticated
WITH CHECK (
  (auth.uid() = user_id) OR
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 1 -- Admin Master
  )
);

-- Updates: Permitir apenas Admin Master
CREATE POLICY "contract_acceptances_update_admin_master"
ON public.contract_acceptances
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 1
  )
);

-- Deletes: Permitir apenas Admin Master
CREATE POLICY "contract_acceptances_delete_admin_master"
ON public.contract_acceptances
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 1
  )
);

-- Adiciona coluna contract_version_accepted_id para perfis e empresas
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS contract_version_accepted_id UUID REFERENCES public.event_contracts(id) ON DELETE SET NULL;

ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS contract_version_accepted_id UUID REFERENCES public.event_contracts(id) ON DELETE SET NULL;
