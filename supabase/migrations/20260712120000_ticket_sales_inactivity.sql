-- Inatividade comercial: eventos realizados no mês sem venda de ingressos (planos comissão/híbrido).

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS ticket_inactivity_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ticket_inactivity_fee_default NUMERIC(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.system_billing_settings.ticket_inactivity_enabled IS
  'Ativa verificação mensal de eventos sem venda de ingressos.';
COMMENT ON COLUMN public.system_billing_settings.ticket_inactivity_fee_default IS
  'Taxa fixa global (v2) por inatividade repetida; v1 só bloqueio.';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ticket_inactivity_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_inactivity_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ticket_inactivity_reference_month DATE;

COMMENT ON COLUMN public.companies.ticket_inactivity_blocked IS
  'Bloqueia criar/reativar eventos até resolver pendência de inatividade de vendas.';
COMMENT ON COLUMN public.companies.ticket_inactivity_reference_month IS
  'Primeiro dia do mês calendário analisado (ex.: 2026-03-01).';

CREATE TABLE IF NOT EXISTS public.company_ticket_inactivity_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  event_title TEXT,
  ticket_sales_count INTEGER NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT company_ticket_inactivity_flags_month_chk
    CHECK (reference_month = date_trunc('month', reference_month)::date),
  CONSTRAINT company_ticket_inactivity_flags_unique
    UNIQUE (company_id, event_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_company_ticket_inactivity_flags_company
  ON public.company_ticket_inactivity_flags(company_id, reference_month DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.company_ticket_inactivity_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_ticket_inactivity_flags_select ON public.company_ticket_inactivity_flags;
CREATE POLICY company_ticket_inactivity_flags_select
  ON public.company_ticket_inactivity_flags
  FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
        AND uc.company_id = company_ticket_inactivity_flags.company_id
    )
  );

DROP POLICY IF EXISTS company_ticket_inactivity_flags_admin_all ON public.company_ticket_inactivity_flags;
CREATE POLICY company_ticket_inactivity_flags_admin_all
  ON public.company_ticket_inactivity_flags
  FOR ALL TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

CREATE OR REPLACE FUNCTION public.event_ticket_sales_in_month(
  p_event_id UUID,
  p_reference_month DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.receivables r
  WHERE r.event_id = p_event_id
    AND r.created_at >= p_reference_month::timestamptz
    AND r.created_at < (p_reference_month + INTERVAL '1 month')::timestamptz
    AND (
      r.status = 'paid'
      OR r.payment_status IN ('approved', 'authorized')
    );
$$;

CREATE OR REPLACE FUNCTION public.company_has_unresolved_ticket_inactivity(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_ticket_inactivity_flags f
    INNER JOIN public.events e ON e.id = f.event_id
    WHERE f.company_id = p_company_id
      AND f.resolved_at IS NULL
      AND COALESCE(e.is_active, false) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.try_clear_company_ticket_inactivity(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.company_has_unresolved_ticket_inactivity(p_company_id) THEN
    UPDATE public.companies c
    SET
      ticket_inactivity_blocked = false,
      ticket_inactivity_blocked_at = NULL,
      ticket_inactivity_reference_month = NULL
    WHERE c.id = p_company_id
      AND c.ticket_inactivity_blocked = true;

    UPDATE public.company_ticket_inactivity_flags f
    SET resolved_at = timezone('utc'::text, now())
    WHERE f.company_id = p_company_id
      AND f.resolved_at IS NULL;

    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_company_not_ticket_inactive(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN;
  END IF;

  IF NOT public.company_requires_paid_ticket_event(p_company_id) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = p_company_id
      AND c.ticket_inactivity_blocked = true
  ) THEN
    RAISE EXCEPTION
      'Pendência de inatividade comercial: há evento(s) realizados sem venda de ingressos. Desative o(s) evento(s) na lista de eventos ou solicite liberação ao suporte EventFest.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_ticket_inactivity_check(p_reference_month DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_enabled BOOLEAN;
  v_company RECORD;
  v_event RECORD;
  v_sales INTEGER;
  v_flagged INTEGER := 0;
  v_companies_blocked INTEGER := 0;
  v_company_flagged BOOLEAN;
BEGIN
  v_month := COALESCE(
    p_reference_month,
    (date_trunc('month', timezone('utc'::text, now())) - INTERVAL '1 month')::date
  );
  v_month := date_trunc('month', v_month)::date;

  SELECT COALESCE(s.ticket_inactivity_enabled, true)
  INTO v_enabled
  FROM public.system_billing_settings s
  WHERE s.id = 1;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'disabled');
  END IF;

  FOR v_company IN
    SELECT c.id
    FROM public.companies c
    WHERE public.company_requires_paid_ticket_event(c.id)
  LOOP
    v_company_flagged := false;

    FOR v_event IN
      SELECT e.id, e.title, e.date
      FROM public.events e
      WHERE e.company_id = v_company.id
        AND COALESCE(e.is_paid, false) = true
        AND COALESCE(e.listing_only, false) = false
        AND e.date >= v_month
        AND e.date < (v_month + INTERVAL '1 month')::date
    LOOP
      v_sales := public.event_ticket_sales_in_month(v_event.id, v_month);

      IF v_sales = 0 THEN
        INSERT INTO public.company_ticket_inactivity_flags (
          company_id, event_id, reference_month, event_title, ticket_sales_count
        )
        VALUES (
          v_company.id, v_event.id, v_month, v_event.title, v_sales
        )
        ON CONFLICT (company_id, event_id, reference_month)
        DO UPDATE SET
          event_title = EXCLUDED.event_title,
          ticket_sales_count = EXCLUDED.ticket_sales_count,
          resolved_at = NULL,
          resolved_by = NULL;

        v_flagged := v_flagged + 1;
        v_company_flagged := true;
      END IF;
    END LOOP;

    IF v_company_flagged THEN
      UPDATE public.companies c
      SET
        ticket_inactivity_blocked = true,
        ticket_inactivity_blocked_at = timezone('utc'::text, now()),
        ticket_inactivity_reference_month = v_month
      WHERE c.id = v_company.id;

      v_companies_blocked := v_companies_blocked + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reference_month', v_month,
    'events_flagged', v_flagged,
    'companies_blocked', v_companies_blocked
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_run_ticket_inactivity_check(p_reference_month DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode executar a verificação de inatividade.';
  END IF;

  RETURN public.run_ticket_inactivity_check(p_reference_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_company_ticket_inactivity(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode liberar inatividade.';
  END IF;

  UPDATE public.company_ticket_inactivity_flags f
  SET
    resolved_at = timezone('utc'::text, now()),
    resolved_by = auth.uid()
  WHERE f.company_id = p_company_id
    AND f.resolved_at IS NULL;

  UPDATE public.companies c
  SET
    ticket_inactivity_blocked = false,
    ticket_inactivity_blocked_at = NULL,
    ticket_inactivity_reference_month = NULL
  WHERE c.id = p_company_id;

  RETURN jsonb_build_object('success', true, 'company_id', p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_ticket_inactivity_status(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_blocked BOOLEAN;
  v_month DATE;
  v_events JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = v_user AND uc.company_id = p_company_id
    )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    c.ticket_inactivity_blocked,
    c.ticket_inactivity_reference_month
  INTO v_blocked, v_month
  FROM public.companies c
  WHERE c.id = p_company_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'event_id', f.event_id,
      'event_title', COALESCE(f.event_title, e.title),
      'event_date', e.date,
      'is_active', COALESCE(e.is_active, false),
      'reference_month', f.reference_month
    )
    ORDER BY e.date
  ), '[]'::jsonb)
  INTO v_events
  FROM public.company_ticket_inactivity_flags f
  INNER JOIN public.events e ON e.id = f.event_id
  WHERE f.company_id = p_company_id
    AND f.resolved_at IS NULL;

  RETURN jsonb_build_object(
    'blocked', COALESCE(v_blocked, false),
    'reference_month', v_month,
    'pending_events', v_events
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_try_clear_ticket_inactivity_on_event_deactivate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_active, false) = true
     AND COALESCE(NEW.is_active, false) = false
     AND NEW.company_id IS NOT NULL THEN
    PERFORM public.try_clear_company_ticket_inactivity(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_try_clear_ticket_inactivity_on_event_deactivate ON public.events;
CREATE TRIGGER trg_try_clear_ticket_inactivity_on_event_deactivate
  AFTER UPDATE OF is_active ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_try_clear_ticket_inactivity_on_event_deactivate();

-- Reaplica enforce_billing_plan_on_events com bloqueio de inatividade
CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_min INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.assert_company_not_ticket_inactive(NEW.company_id);
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

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.is_active, false) = true
     AND COALESCE(OLD.is_active, false) = false THEN
    PERFORM public.assert_company_not_ticket_inactive(NEW.company_id);
  END IF;

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

REVOKE ALL ON FUNCTION public.event_ticket_sales_in_month(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_has_unresolved_ticket_inactivity(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_clear_company_ticket_inactivity(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_company_not_ticket_inactive(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_ticket_inactivity_check(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_run_ticket_inactivity_check(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_clear_company_ticket_inactivity(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_ticket_inactivity_status(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_ticket_sales_in_month(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_has_unresolved_ticket_inactivity(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.try_clear_company_ticket_inactivity(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_company_not_ticket_inactive(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_ticket_inactivity_check(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_run_ticket_inactivity_check(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_company_ticket_inactivity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_ticket_inactivity_status(UUID) TO authenticated;
