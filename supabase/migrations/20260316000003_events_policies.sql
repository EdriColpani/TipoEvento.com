-- Habilita RLS na tabela events (se ainda não estiver habilitado)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Remove policies antigas conflitantes (se existirem) para evitar duplicidade de nomes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events' AND policyname = 'events_insert_managers_and_admin') THEN
    EXECUTE 'DROP POLICY "events_insert_managers_and_admin" ON public.events';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events' AND policyname = 'events_select_authenticated') THEN
    EXECUTE 'DROP POLICY "events_select_authenticated" ON public.events';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events' AND policyname = 'events_update_owner_or_admin') THEN
    EXECUTE 'DROP POLICY "events_update_owner_or_admin" ON public.events';
  END IF;
END $$;

-- 1) Leitura: qualquer usuário autenticado pode ler eventos
CREATE POLICY "events_select_authenticated"
ON public.events
FOR SELECT
USING (
  auth.role() = 'authenticated'
);

-- 2) Inserção: somente Admin Master (tipo_usuario_id = 1) e Gestor PRO (tipo_usuario_id = 2)
--    vinculados ao profile atual, gravando o created_by como auth.uid()
CREATE POLICY "events_insert_managers_and_admin"
ON public.events
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id IN (1, 2)
  )
);

-- 3) Atualização: Admin Master pode atualizar qualquer evento; Gestor PRO só eventos criados por ele
CREATE POLICY "events_update_owner_or_admin"
ON public.events
FOR UPDATE
USING (
  auth.role() = 'authenticated'
  AND (
    -- Admin Master
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.tipo_usuario_id = 1
    )
    OR
    -- Gestor PRO que é o criador do evento
    (created_by = auth.uid())
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.tipo_usuario_id = 1
    )
    OR
    (created_by = auth.uid())
  )
);

