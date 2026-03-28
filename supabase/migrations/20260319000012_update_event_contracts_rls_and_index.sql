-- Adiciona um índice único parcial para garantir apenas 1 contrato ativo por tipo
-- (Primeiro, remove o índice antigo se existir, para não haver conflito)
DROP INDEX IF EXISTS idx_event_contracts_is_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_contracts_active_per_type
ON public.event_contracts (contract_type) WHERE is_active IS TRUE;

-- Adiciona RLS para a nova coluna (se o RLS estiver ativado na tabela)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'event_contracts'
      AND policyname = 'Admin Master can manage event_contracts'
  ) THEN
    -- Remove a policy antiga que não considerava o tipo, se ela existir
    EXECUTE 'DROP POLICY "Admin Master can manage event_contracts" ON public.event_contracts';
  END IF;

  -- Re-cria a policy, agora com suporte ao tipo
  CREATE POLICY "event_contracts_manage_by_admin_master"
  ON public.event_contracts
  FOR ALL
  TO authenticated
  USING (
      EXISTS (
          SELECT 1 FROM public.profiles
          WHERE public.profiles.id = auth.uid()
          AND public.profiles.tipo_usuario_id = 1 -- Admin Master
      )
  )
  WITH CHECK (
      EXISTS (
          SELECT 1 FROM public.profiles
          WHERE public.profiles.id = auth.uid()
          AND public.profiles.tipo_usuario_id = 1 -- Admin Master
      )
  );
END
$$;

-- Permitir leitura de contratos para todos os usuários autenticados (inclui o tipo)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'event_contracts'
      AND policyname = 'Authenticated users can read event_contracts'
  ) THEN
    EXECUTE 'DROP POLICY "Authenticated users can read event_contracts" ON public.event_contracts';
  END IF;

  CREATE POLICY "event_contracts_select_authenticated"
  ON public.event_contracts
  FOR SELECT
  TO authenticated, anon
  USING (
    -- Adicione aqui condições de leitura se precisar de restrições por tipo
    TRUE -- Por enquanto, todos autenticados podem ler todos os tipos de contrato
  );
END
$$;
