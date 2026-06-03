-- Gestor PRO: listar, editar e excluir banners dos próprios eventos (via events.created_by).

ALTER TABLE public.event_carousel_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_carousel_banners_select_manager ON public.event_carousel_banners;
CREATE POLICY event_carousel_banners_select_manager
  ON public.event_carousel_banners
  FOR SELECT
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_carousel_banners.event_id
        AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS event_carousel_banners_update_manager ON public.event_carousel_banners;
CREATE POLICY event_carousel_banners_update_manager
  ON public.event_carousel_banners
  FOR UPDATE
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_carousel_banners.event_id
        AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_carousel_banners.event_id
        AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS event_carousel_banners_delete_manager ON public.event_carousel_banners;
CREATE POLICY event_carousel_banners_delete_manager
  ON public.event_carousel_banners
  FOR DELETE
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_carousel_banners.event_id
        AND e.created_by = auth.uid()
    )
  );
