-- Bloqueio de cadastro de evento com 3+ chargebacks de ingresso em aberto

CREATE OR REPLACE FUNCTION public.company_open_ticket_chargeback_stats(p_company_id UUID)
RETURNS TABLE (
  open_count INTEGER,
  pending_amount NUMERIC,
  oldest_open_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(round(d.amount_due - d.amount_applied, 2)), 0)::numeric,
    MIN(d.created_at)
  FROM public.manager_ticket_chargeback_debt d
  WHERE d.company_id = p_company_id
    AND d.status IN ('open', 'partial')
    AND round(d.amount_due - d.amount_applied, 2) > 0;
$$;

CREATE OR REPLACE FUNCTION public.get_company_ticket_chargeback_block_status(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_amount NUMERIC(14, 2) := 0;
  v_oldest TIMESTAMPTZ;
  v_threshold INTEGER := 3;
  v_contact JSONB;
  v_pay JSONB;
  v_items JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR public.user_owns_company(p_company_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT s.open_count, s.pending_amount, s.oldest_open_at
  INTO v_count, v_amount, v_oldest
  FROM public.company_open_ticket_chargeback_stats(p_company_id) s;

  v_contact := public.get_public_contact_info();
  v_pay := public.get_ticket_chargeback_payment_instructions();

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at ASC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      d.id,
      d.created_at,
      round(d.amount_due - d.amount_applied, 2) AS amount_remaining,
      d.recovery_mode,
      d.status,
      ('EF-TCB-' || upper(substr(replace(d.id::text, '-', ''), 1, 10))) AS payment_ref_hint,
      e.title AS event_title
    FROM public.manager_ticket_chargeback_debt d
    INNER JOIN public.ticket_chargeback_cases c ON c.id = d.chargeback_case_id
    LEFT JOIN public.events e ON e.id = c.event_id
    WHERE d.company_id = p_company_id
      AND d.status IN ('open', 'partial')
      AND round(d.amount_due - d.amount_applied, 2) > 0
    ORDER BY d.created_at ASC
    LIMIT 20
  ) t;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'threshold', v_threshold,
    'open_count', COALESCE(v_count, 0),
    'pending_amount', round(COALESCE(v_amount, 0), 2),
    'oldest_open_at', v_oldest,
    'warning', COALESCE(v_count, 0) >= 1 AND COALESCE(v_count, 0) < v_threshold,
    'blocked', COALESCE(v_count, 0) >= v_threshold,
    'remaining_until_block', greatest(0, v_threshold - COALESCE(v_count, 0)),
    'contact', COALESCE(v_contact, '{}'::jsonb),
    'payment_instructions', COALESCE(v_pay, '{}'::jsonb),
    'items', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_company_ticket_chargeback_create_allowed(
  p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_amount NUMERIC(14, 2) := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN;
  END IF;

  IF p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT s.open_count, s.pending_amount
  INTO v_count, v_amount
  FROM public.company_open_ticket_chargeback_stats(p_company_id) s;

  IF COALESCE(v_count, 0) >= 3 THEN
    RAISE EXCEPTION
      'Cadastro de eventos bloqueado: há % chargeback(s) de ingresso em aberto (limite 3), total pendente R$ %. Entre em contato com a EventFest para quitar e liberar o cadastro.',
      v_count,
      to_char(round(COALESCE(v_amount, 0), 2), 'FM999999990.00');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_billing_plan_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_min INTEGER;
  v_is_master BOOLEAN;
  v_blocked BOOLEAN;
  v_count INTEGER;
  v_cb_count INTEGER := 0;
BEGIN
  v_is_master := auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls();

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_is_master THEN
    SELECT COALESCE(c.ticket_inactivity_blocked, false)
    INTO v_blocked
    FROM public.companies c
    WHERE c.id = NEW.company_id;

    IF TG_OP = 'INSERT' AND v_blocked THEN
      PERFORM public.log_admin_master_bypass(
        'ticket_inactivity_create_event',
        'Admin Master criou evento com pendência de inatividade comercial.',
        NEW.company_id,
        NULL,
        jsonb_build_object('event_title', NEW.title)
      );
    END IF;

    SELECT s.open_count INTO v_cb_count
    FROM public.company_open_ticket_chargeback_stats(NEW.company_id) s;

    IF TG_OP = 'INSERT' AND COALESCE(v_cb_count, 0) >= 3 THEN
      PERFORM public.log_admin_master_bypass(
        'ticket_chargeback_create_event',
        'Admin Master criou evento com 3+ chargebacks de ingresso em aberto.',
        NEW.company_id,
        NULL,
        jsonb_build_object('event_title', NEW.title, 'open_chargebacks', v_cb_count)
      );
    END IF;

    IF TG_OP = 'UPDATE'
       AND COALESCE(NEW.is_active, false) = true
       AND COALESCE(OLD.is_active, false) = false
       AND v_blocked THEN
      PERFORM public.log_admin_master_bypass(
        'ticket_inactivity_activate_event',
        'Admin Master reativou evento com pendência de inatividade comercial.',
        NEW.company_id,
        NEW.id,
        jsonb_build_object('event_title', NEW.title)
      );
    END IF;

    IF TG_OP = 'UPDATE'
       AND COALESCE(NEW.is_active, false) = true
       AND COALESCE(OLD.is_active, false) = false
       AND public.company_requires_paid_ticket_event(NEW.company_id)
       AND COALESCE(NEW.is_paid, false) = true THEN
      v_min := public.get_company_min_event_tickets(NEW.company_id);
      v_count := public.event_active_wristband_count(NEW.id);
      IF v_count < v_min THEN
        PERFORM public.log_admin_master_bypass(
          'min_event_tickets_activate',
          format('Admin Master ativou evento com %s ingressos (mínimo %s).', v_count, v_min),
          NEW.company_id,
          NEW.id,
          jsonb_build_object('active_count', v_count, 'min_required', v_min)
        );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.assert_company_not_ticket_inactive(NEW.company_id);
    PERFORM public.assert_company_ticket_chargeback_create_allowed(NEW.company_id);
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
    PERFORM public.assert_company_ticket_chargeback_create_allowed(NEW.company_id);
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

REVOKE ALL ON FUNCTION public.company_open_ticket_chargeback_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_ticket_chargeback_block_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_company_ticket_chargeback_create_allowed(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.company_open_ticket_chargeback_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_open_ticket_chargeback_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_ticket_chargeback_block_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_company_ticket_chargeback_create_allowed(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_company_ticket_chargeback_create_allowed(UUID) TO service_role;
