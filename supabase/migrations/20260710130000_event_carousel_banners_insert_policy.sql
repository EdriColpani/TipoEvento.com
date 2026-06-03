-- Permite criar banner de evento: Admin Master ou gestor dono do evento (faltava na migration anterior).

DROP POLICY IF EXISTS event_carousel_banners_insert_manager ON public.event_carousel_banners;
CREATE POLICY event_carousel_banners_insert_manager
  ON public.event_carousel_banners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_carousel_banners.event_id
        AND e.created_by = auth.uid()
    )
  );
