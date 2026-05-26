-- Fase 7: carteira mobile (PWA) + biometria opcional para spend alto

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'system_billing_settings'
  ) THEN
    ALTER TABLE public.system_billing_settings
      ADD COLUMN IF NOT EXISTS credit_spend_biometric_threshold NUMERIC(12, 2) NOT NULL DEFAULT 200.00;

    COMMENT ON COLUMN public.system_billing_settings.credit_spend_biometric_threshold IS
      'Valor mínimo (R$) de spend que exige confirmação biométrica no app mobile/PWA. 0 = desligado.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_credit_spend_biometric_threshold()
RETURNS NUMERIC(12, 2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    0,
    COALESCE(
      (SELECT s.credit_spend_biometric_threshold FROM public.system_billing_settings s WHERE s.id = 1),
      200.00
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_credit_wallet_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module BOOLEAN;
  v_commission NUMERIC(5, 2);
  v_bio_threshold NUMERIC(12, 2);
BEGIN
  v_module := public.credit_module_globally_enabled();
  v_commission := public.get_credit_consumption_commission_pct();
  v_bio_threshold := public.get_credit_spend_biometric_threshold();

  RETURN jsonb_build_object(
    'module_enabled', v_module,
    'can_topup', v_module,
    'can_use', v_module,
    'consumption_commission_pct', v_commission,
    'biometric_threshold', v_bio_threshold,
    'biometric_enabled', v_bio_threshold > 0,
    'mobile_wallet_ready', v_module,
    'message', CASE
      WHEN NOT v_module THEN
        'O módulo de créditos EventFest ainda não está disponível. Tente novamente em breve.'
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_credit_spend_biometric_threshold() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_credit_wallet_status() TO authenticated;
