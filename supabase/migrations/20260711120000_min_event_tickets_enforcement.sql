-- Mínimo de ingressos por empresa (global + override) e regras anti-fraude em planos com comissão.

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS min_event_tickets_default INTEGER NOT NULL DEFAULT 10
    CHECK (min_event_tickets_default >= 1 AND min_event_tickets_default <= 100000);

COMMENT ON COLUMN public.system_billing_settings.min_event_tickets_default IS
  'Quantidade mínima padrão de ingressos (lotes/pulseiras) por evento pago; Admin Master.';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS min_event_tickets INTEGER,
  ADD COLUMN IF NOT EXISTS min_event_tickets_customized BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.min_event_tickets IS
  'Mínimo de ingressos exigido para eventos pagos desta empresa.';
COMMENT ON COLUMN public.companies.min_event_tickets_customized IS
  'true = valor definido manualmente pelo admin; não sobrescrever ao alterar o padrão global.';

UPDATE public.system_billing_settings
SET min_event_tickets_default = 10
WHERE id = 1;

UPDATE public.companies c
SET
  min_event_tickets = COALESCE(c.min_event_tickets, s.min_event_tickets_default, 10),
  min_event_tickets_customized = COALESCE(c.min_event_tickets_customized, false)
FROM public.system_billing_settings s
WHERE s.id = 1;

ALTER TABLE public.companies
  ALTER COLUMN min_event_tickets SET NOT NULL;

CREATE OR REPLACE FUNCTION public.get_min_event_tickets_default()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.min_event_tickets_default FROM public.system_billing_settings s WHERE s.id = 1),
    10
  );
$$;

CREATE OR REPLACE FUNCTION public.get_company_min_event_tickets(p_company_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT c.min_event_tickets FROM public.companies c WHERE c.id = p_company_id),
    public.get_min_event_tickets_default()
  );
$$;

CREATE OR REPLACE FUNCTION public.company_requires_paid_ticket_event(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT c.billing_plan IN (
        'ticket_commission'::public.billing_plan_type,
        'ticket_plus_consumption'::public.billing_plan_type
      )
      FROM public.companies c
      WHERE c.id = p_company_id
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.event_batch_ticket_quantity_sum(p_event_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(b.quantity)::INTEGER, 0)
  FROM public.event_batches b
  WHERE b.event_id = p_event_id
    AND b.price > 0;
$$;

CREATE OR REPLACE FUNCTION public.event_active_wristband_count(p_event_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.wristbands w
  WHERE w.event_id = p_event_id
    AND w.status = 'active'
    AND COALESCE(w.price, 0) > 0;
$$;

CREATE OR REPLACE FUNCTION public.event_meets_min_tickets_for_activation(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_min INTEGER;
  v_requires_paid BOOLEAN;
  v_is_paid BOOLEAN;
BEGIN
  SELECT e.company_id, COALESCE(e.is_paid, false)
  INTO v_company_id, v_is_paid
  FROM public.events e
  WHERE e.id = p_event_id;

  IF v_company_id IS NULL OR NOT v_is_paid THEN
    RETURN true;
  END IF;

  v_requires_paid := public.company_requires_paid_ticket_event(v_company_id);
  IF NOT v_requires_paid THEN
    RETURN true;
  END IF;

  v_min := public.get_company_min_event_tickets(v_company_id);
  RETURN public.event_active_wristband_count(p_event_id) >= v_min;
END;
$$;

-- Nova empresa: copia mínimo global
CREATE OR REPLACE FUNCTION public.set_company_min_event_tickets_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.min_event_tickets IS NULL OR NEW.min_event_tickets < 1 THEN
    NEW.min_event_tickets := public.get_min_event_tickets_default();
  END IF;
  IF NEW.min_event_tickets_customized IS NULL THEN
    NEW.min_event_tickets_customized := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_company_min_event_tickets_on_insert ON public.companies;
CREATE TRIGGER trg_set_company_min_event_tickets_on_insert
  BEFORE INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_company_min_event_tickets_on_insert();

-- Admin Master: alterar padrão global e propagar para empresas não personalizadas
CREATE OR REPLACE FUNCTION public.admin_set_min_event_tickets_default(
  p_min_tickets INTEGER,
  p_apply_to_non_customized BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode alterar o mínimo global de ingressos.';
  END IF;

  IF p_min_tickets IS NULL OR p_min_tickets < 1 OR p_min_tickets > 100000 THEN
    RAISE EXCEPTION 'Informe uma quantidade mínima entre 1 e 100000.';
  END IF;

  UPDATE public.system_billing_settings
  SET
    min_event_tickets_default = p_min_tickets,
    updated_at = timezone('utc'::text, now())
  WHERE id = 1;

  IF p_apply_to_non_customized THEN
    UPDATE public.companies
    SET min_event_tickets = p_min_tickets
    WHERE NOT COALESCE(min_event_tickets_customized, false);

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'min_event_tickets_default', p_min_tickets,
    'companies_updated', v_updated
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_company_min_event_tickets(
  p_company_id UUID,
  p_min_tickets INTEGER,
  p_restore_global_default BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min INTEGER;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode alterar o mínimo de ingressos da empresa.';
  END IF;

  IF p_restore_global_default THEN
    v_min := public.get_min_event_tickets_default();
    UPDATE public.companies
    SET
      min_event_tickets = v_min,
      min_event_tickets_customized = false
    WHERE id = p_company_id;
  ELSE
    IF p_min_tickets IS NULL OR p_min_tickets < 1 OR p_min_tickets > 100000 THEN
      RAISE EXCEPTION 'Informe uma quantidade mínima entre 1 e 100000.';
    END IF;
    UPDATE public.companies
    SET
      min_event_tickets = p_min_tickets,
      min_event_tickets_customized = true
    WHERE id = p_company_id;
    v_min := p_min_tickets;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'min_event_tickets', v_min,
    'customized', NOT p_restore_global_default
  );
END;
$$;

-- Eventos: planos com comissão/híbrido exigem evento pago; vitrine mantém regra anterior
CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_min INTEGER;
  v_batch_sum INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_plan_feature(NEW.company_id, 'events_create');
  ELSIF TG_OP = 'INSERT' AND NOT public.company_plan_feature_enabled(NEW.company_id, 'events_create') THEN
    RAISE EXCEPTION
      'O recurso "%" não está disponível no plano comercial desta empresa.',
      public.plan_feature_label('events_create');
  END IF;

  SELECT c.billing_plan INTO v_plan
  FROM public.companies c
  WHERE c.id = NEW.company_id;

  IF v_plan IN (
    'listing_monthly'::public.billing_plan_type,
    'consumption_or_license'::public.billing_plan_type
  ) THEN
    IF COALESCE(NEW.is_paid, false) = true THEN
      RAISE EXCEPTION 'Este plano comercial não permite eventos com venda de ingressos pela plataforma.';
    END IF;
    NEW.listing_only := true;
    NEW.is_paid := false;
  ELSIF v_plan IN (
    'ticket_commission'::public.billing_plan_type,
    'ticket_plus_consumption'::public.billing_plan_type
  ) THEN
    NEW.is_paid := true;
    NEW.listing_only := false;

    IF TG_OP = 'INSERT' THEN
      NEW.is_active := false;
    END IF;

    IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_paid, false) = true AND COALESCE(NEW.is_paid, false) = false THEN
      RAISE EXCEPTION 'Plano com comissão sobre ingressos exige evento pago. Não é permitido alterar para gratuito.';
    END IF;
  END IF;

  -- Ativação pública: exige pulseiras ativas >= mínimo da empresa (planos comissão)
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.is_active, false) = true
     AND COALESCE(OLD.is_active, false) = false
     AND public.company_requires_paid_ticket_event(NEW.company_id)
     AND COALESCE(NEW.is_paid, false) = true THEN
    v_min := public.get_company_min_event_tickets(NEW.company_id);
    IF public.event_active_wristband_count(NEW.id) < v_min THEN
      RAISE EXCEPTION
        'Para ativar o evento, cadastre pelo menos % ingressos ativos. Mínimo da sua empresa: %.',
        v_min, v_min;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.get_min_event_tickets_default() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_min_event_tickets(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_requires_paid_ticket_event(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_batch_ticket_quantity_sum(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_active_wristband_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_meets_min_tickets_for_activation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_min_event_tickets_default(INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_company_min_event_tickets(UUID, INTEGER, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_min_event_tickets_default() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_min_event_tickets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_requires_paid_ticket_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_batch_ticket_quantity_sum(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_active_wristband_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_meets_min_tickets_for_activation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_min_event_tickets_default(INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_min_event_tickets(UUID, INTEGER, BOOLEAN) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_min_event_tickets_default() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_min_event_tickets(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.company_requires_paid_ticket_event(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_batch_ticket_quantity_sum(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_active_wristband_count(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_meets_min_tickets_for_activation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_min_event_tickets_default(INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_company_min_event_tickets(UUID, INTEGER, BOOLEAN) TO service_role;
