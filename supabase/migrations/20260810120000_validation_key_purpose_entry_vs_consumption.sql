-- Diferencia chave de portaria (entrada/saída) vs consumo no balcão (entrega EFDEL).

ALTER TABLE public.validation_api_keys
  ADD COLUMN IF NOT EXISTS key_purpose TEXT NOT NULL DEFAULT 'entry_exit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'validation_api_keys_key_purpose_check'
  ) THEN
    ALTER TABLE public.validation_api_keys
      ADD CONSTRAINT validation_api_keys_key_purpose_check
      CHECK (key_purpose IN ('entry_exit', 'consumption_delivery'));
  END IF;
END $$;

COMMENT ON COLUMN public.validation_api_keys.key_purpose IS
  'entry_exit = portaria do evento; consumption_delivery = leitura QR EFDEL no balcão de consumo.';

CREATE INDEX IF NOT EXISTS idx_validation_api_keys_purpose
  ON public.validation_api_keys (key_purpose)
  WHERE is_active = true;

-- Planos de consumo criam chave de balcão via key_purpose=consumption_delivery
-- (não liberar validation_keys genérico em consumption_or_license, para não permitir portaria sem ingresso).

CREATE OR REPLACE FUNCTION public.company_allows_consumption_validation_keys(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = p_company_id
      AND c.billing_plan IN (
        'ticket_plus_consumption'::public.billing_plan_type,
        'consumption_or_license'::public.billing_plan_type
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.company_allows_consumption_validation_keys(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_allows_consumption_validation_keys(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_validation_api_keys()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_purpose TEXT := COALESCE(NULLIF(trim(NEW.key_purpose), ''), 'entry_exit');
BEGIN
  NEW.key_purpose := v_purpose;

  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_company_id := public._company_id_for_event(NEW.event_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Evento não encontrado para vincular a chave de validação.';
  END IF;

  IF v_purpose = 'consumption_delivery' THEN
    IF NOT public.company_allows_consumption_validation_keys(v_company_id) THEN
      RAISE EXCEPTION
        'Chave de consumo no balcão só é permitida em planos com módulo de consumo (híbrido ou consumo/licença).';
    END IF;
    RETURN NEW;
  END IF;

  -- entry_exit (portaria)
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_plan_feature(v_company_id, 'validation_keys');
  ELSIF NOT public.company_plan_feature_enabled(v_company_id, 'validation_keys') THEN
    RAISE EXCEPTION
      'O recurso "%" não está disponível no plano comercial desta empresa.',
      public.plan_feature_label('validation_keys');
  END IF;

  RETURN NEW;
END;
$$;
