-- Policy para permitir DELETE em event_turmas (evita duplicar turmas ao editar)

ALTER TABLE public.event_turmas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'event_turmas'
      AND policyname = 'event_turmas_delete_admin_or_manager'
  ) THEN
    EXECUTE 'DROP POLICY "event_turmas_delete_admin_or_manager" ON public.event_turmas';
  END IF;
END
$$;

-- Gestor PRO cria suas turmas (created_by = auth.uid()).
-- Admin Master também pode deletar tudo.
CREATE POLICY "event_turmas_delete_admin_or_manager"
ON public.event_turmas
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 1
  )
);

