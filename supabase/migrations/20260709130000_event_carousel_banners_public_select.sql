-- Landing / carrossel: visitantes (anon) precisam ler banners no período de exibição.
-- A migration do gestor habilitou RLS sem política pública, o que esvaziou o carrossel na home.

DROP POLICY IF EXISTS event_carousel_banners_select_public_active ON public.event_carousel_banners;
CREATE POLICY event_carousel_banners_select_public_active
  ON public.event_carousel_banners
  FOR SELECT
  TO anon, authenticated
  USING (
    start_date <= CURRENT_DATE
    AND end_date >= CURRENT_DATE
  );

COMMENT ON POLICY event_carousel_banners_select_public_active ON public.event_carousel_banners IS
  'Carrossel da home: exibe apenas banners com período de exibição vigente (inclusive hoje).';
