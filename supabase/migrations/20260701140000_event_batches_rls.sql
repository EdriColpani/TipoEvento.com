-- RLS para lotes de ingressos (event_batches) — gestor dono do evento pode gravar

CREATE TABLE IF NOT EXISTS public.event_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_event_batches_event_id ON public.event_batches (event_id);

ALTER TABLE public.event_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_batches_select_authenticated ON public.event_batches;
CREATE POLICY event_batches_select_authenticated
  ON public.event_batches
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS event_batches_insert_manager ON public.event_batches;
CREATE POLICY event_batches_insert_manager
  ON public.event_batches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_batches.event_id
        AND (
          public.user_is_admin_master_for_rls()
          OR e.created_by = auth.uid()
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.tipo_usuario_id IN (1, 2)
    )
  );

DROP POLICY IF EXISTS event_batches_update_manager ON public.event_batches;
CREATE POLICY event_batches_update_manager
  ON public.event_batches
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_batches.event_id
        AND (
          public.user_is_admin_master_for_rls()
          OR e.created_by = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_batches.event_id
        AND (
          public.user_is_admin_master_for_rls()
          OR e.created_by = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS event_batches_delete_manager ON public.event_batches;
CREATE POLICY event_batches_delete_manager
  ON public.event_batches
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_batches.event_id
        AND (
          public.user_is_admin_master_for_rls()
          OR e.created_by = auth.uid()
        )
    )
  );

GRANT SELECT ON public.event_batches TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.event_batches TO authenticated;
