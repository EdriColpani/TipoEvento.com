-- Carrossel: visitantes só leem banners promocionais no período de exibição.
-- Admin Master continua vendo e editando todos.

ALTER TABLE public.promotional_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promotional_banners_select_public_active ON public.promotional_banners;
CREATE POLICY promotional_banners_select_public_active
  ON public.promotional_banners
  FOR SELECT
  TO anon, authenticated
  USING (
    start_date <= CURRENT_DATE
    AND end_date >= CURRENT_DATE
  );

DROP POLICY IF EXISTS promotional_banners_select_admin ON public.promotional_banners;
CREATE POLICY promotional_banners_select_admin
  ON public.promotional_banners
  FOR SELECT
  TO authenticated
  USING (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS promotional_banners_insert_admin ON public.promotional_banners;
CREATE POLICY promotional_banners_insert_admin
  ON public.promotional_banners
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS promotional_banners_update_admin ON public.promotional_banners;
CREATE POLICY promotional_banners_update_admin
  ON public.promotional_banners
  FOR UPDATE
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS promotional_banners_delete_admin ON public.promotional_banners;
CREATE POLICY promotional_banners_delete_admin
  ON public.promotional_banners
  FOR DELETE
  TO authenticated
  USING (public.user_is_admin_master_for_rls());
