-- Cliente pode ler ingressos (wristband_analytics) vinculados às próprias compras pagas/aprovadas,
-- mesmo antes do webhook concluir client_user_id (emissão pendente).

ALTER TABLE public.wristband_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wristband_analytics_select_own" ON public.wristband_analytics;
CREATE POLICY "wristband_analytics_select_own"
  ON public.wristband_analytics
  FOR SELECT
  TO authenticated
  USING (client_user_id = auth.uid());

DROP POLICY IF EXISTS "wristband_analytics_select_via_paid_receivable" ON public.wristband_analytics;
CREATE POLICY "wristband_analytics_select_via_paid_receivable"
  ON public.wristband_analytics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.receivables r
      WHERE r.client_user_id = auth.uid()
        AND (
          r.status = 'paid'
          OR r.payment_status IN ('approved', 'authorized')
        )
        AND id = ANY (r.wristband_analytics_ids)
    )
  );
