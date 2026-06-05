-- Fase 2 anti-fraude: log bypass Admin Master, badge readiness, inatividade v2 (cobrança + e-mail + cron).

-- ---------------------------------------------------------------------------
-- Log de bypass Admin Master
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_master_bypass_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_admin_master_bypass_log_created
  ON public.admin_master_bypass_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_master_bypass_log_company
  ON public.admin_master_bypass_log(company_id, created_at DESC);

ALTER TABLE public.admin_master_bypass_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_master_bypass_log_select ON public.admin_master_bypass_log;
CREATE POLICY admin_master_bypass_log_select
  ON public.admin_master_bypass_log
  FOR SELECT TO authenticated
  USING (public.user_is_admin_master_for_rls());

CREATE OR REPLACE FUNCTION public.log_admin_master_bypass(
  p_action_type TEXT,
  p_summary TEXT,
  p_company_id UUID DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_is_admin_master_for_rls() THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_master_bypass_log (
    actor_user_id, action_type, company_id, event_id, summary, details
  ) VALUES (
    auth.uid(), p_action_type, p_company_id, p_event_id, p_summary, COALESCE(p_details, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_master_bypass_log(p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      l.id,
      l.action_type,
      l.summary,
      l.company_id,
      l.event_id,
      l.details,
      l.created_at,
      COALESCE(
        NULLIF(trim(u.email), ''),
        NULLIF(trim(CONCAT(p.first_name, ' ', p.last_name)), '')
      ) AS actor_email,
      COALESCE(NULLIF(trim(c.trade_name), ''), c.corporate_name) AS company_name
    FROM public.admin_master_bypass_log l
    LEFT JOIN auth.users u ON u.id = l.actor_user_id
    LEFT JOIN public.profiles p ON p.id = l.actor_user_id
    LEFT JOIN public.companies c ON c.id = l.company_id
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  ) s;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

-- Readiness de ingressos para badge na lista de eventos
CREATE OR REPLACE FUNCTION public.get_manager_events_ticket_readiness(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_min INTEGER;
  v_rows JSONB;
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

  IF NOT public.company_requires_paid_ticket_event(p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  v_min := public.get_company_min_event_tickets(p_company_id);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'event_id', e.id,
      'active_ticket_count', public.event_active_wristband_count(e.id),
      'min_required', v_min,
      'needs_more', public.event_active_wristband_count(e.id) < v_min
    )
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.events e
  WHERE e.company_id = p_company_id
    AND COALESCE(e.is_paid, false) = true
    AND COALESCE(e.listing_only, false) = false
    AND COALESCE(e.is_draft, false) = false
    AND COALESCE(e.is_active, false) = false;

  RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- Inatividade v2: cobranças após 2 meses consecutivos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_ticket_inactivity_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  consecutive_months INTEGER NOT NULL DEFAULT 2,
  notes TEXT,
  paid_at TIMESTAMPTZ,
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  checkout_initiated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (company_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_ticket_inactivity_charges_company_month
  ON public.company_ticket_inactivity_charges(company_id, reference_month DESC);

ALTER TABLE public.company_ticket_inactivity_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_inactivity_charges_select ON public.company_ticket_inactivity_charges;
CREATE POLICY ticket_inactivity_charges_select
  ON public.company_ticket_inactivity_charges
  FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_ticket_inactivity_charges.company_id
        AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ticket_inactivity_charges_admin_all ON public.company_ticket_inactivity_charges;
CREATE POLICY ticket_inactivity_charges_admin_all
  ON public.company_ticket_inactivity_charges
  FOR ALL TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

CREATE TABLE IF NOT EXISTS public.company_ticket_inactivity_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  recipient_email TEXT NOT NULL,
  notification_type TEXT NOT NULL DEFAULT 'blocked'
    CHECK (notification_type IN ('blocked', 'charge_created')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  resend_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT company_ticket_inactivity_notifications_unique
    UNIQUE (company_id, reference_month, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_ticket_inactivity_notifications_pending
  ON public.company_ticket_inactivity_notifications(created_at)
  WHERE sent_at IS NULL;

ALTER TABLE public.company_ticket_inactivity_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_inactivity_notifications_admin ON public.company_ticket_inactivity_notifications;
CREATE POLICY ticket_inactivity_notifications_admin
  ON public.company_ticket_inactivity_notifications
  FOR ALL TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

CREATE OR REPLACE FUNCTION public.company_has_consecutive_ticket_inactivity(
  p_company_id UUID,
  p_reference_month DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_ticket_inactivity_flags f_curr
    WHERE f_curr.company_id = p_company_id
      AND f_curr.reference_month = date_trunc('month', p_reference_month)::date
  )
  AND EXISTS (
    SELECT 1
    FROM public.company_ticket_inactivity_flags f_prev
    WHERE f_prev.company_id = p_company_id
      AND f_prev.reference_month = (date_trunc('month', p_reference_month)::date - INTERVAL '1 month')::date
  );
$$;

CREATE OR REPLACE FUNCTION public.get_ticket_inactivity_fee_default()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.ticket_inactivity_fee_default FROM public.system_billing_settings s WHERE s.id = 1),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_ticket_inactivity_charge(
  p_company_id UUID,
  p_reference_month DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_amount NUMERIC(10, 2);
  v_charge RECORD;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.user_can_manage_company_billing(p_company_id)
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão para esta empresa.';
  END IF;

  IF NOT public.company_requires_paid_ticket_event(p_company_id) THEN
    RAISE EXCEPTION 'Empresa não está em plano com cobrança de ingressos.';
  END IF;

  v_month := date_trunc('month', p_reference_month)::date;
  v_amount := public.get_ticket_inactivity_fee_default();

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'fee_disabled');
  END IF;

  IF NOT public.company_has_consecutive_ticket_inactivity(p_company_id, v_month) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'not_consecutive');
  END IF;

  SELECT * INTO v_charge
  FROM public.company_ticket_inactivity_charges
  WHERE company_id = p_company_id AND reference_month = v_month;

  IF v_charge.id IS NOT NULL AND v_charge.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'charge_id', v_charge.id,
      'amount', v_charge.amount,
      'status', v_charge.status,
      'already_paid', true
    );
  END IF;

  INSERT INTO public.company_ticket_inactivity_charges (
    company_id, reference_month, amount, status, consecutive_months
  )
  VALUES (p_company_id, v_month, v_amount, 'pending', 2)
  ON CONFLICT (company_id, reference_month)
  DO UPDATE SET
    amount = EXCLUDED.amount,
    updated_at = timezone('utc'::text, now())
  WHERE company_ticket_inactivity_charges.status = 'pending'
  RETURNING * INTO v_charge;

  IF v_charge.id IS NULL THEN
    SELECT * INTO v_charge
    FROM public.company_ticket_inactivity_charges
    WHERE company_id = p_company_id AND reference_month = v_month;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge.id,
    'amount', v_charge.amount,
    'status', v_charge.status,
    'already_paid', v_charge.status = 'paid'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_ticket_inactivity_charge_mp_preference(
  p_charge_id UUID,
  p_preference_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_ticket_inactivity_charges
  SET
    mp_preference_id = p_preference_id,
    checkout_initiated_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ticket_inactivity_charge_payment(
  p_charge_id UUID,
  p_mp_payment_id TEXT DEFAULT NULL,
  p_mp_fee_amount NUMERIC DEFAULT NULL,
  p_net_received_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_ticket_inactivity_charges
  SET
    status = 'paid',
    paid_at = timezone('utc'::text, now()),
    mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
    updated_at = timezone('utc'::text, now()),
    notes = COALESCE(notes, '') ||
      CASE
        WHEN p_mp_fee_amount IS NOT NULL THEN ' | MP fee: ' || p_mp_fee_amount::text
        ELSE ''
      END
  WHERE id = p_charge_id
    AND status <> 'paid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada ou já paga.';
  END IF;

  RETURN jsonb_build_object('success', true, 'charge_id', p_charge_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_ticket_inactivity_charge_status(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_charge RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.user_is_admin_master_for_rls()
    OR public.user_can_manage_company_billing(p_company_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_charge
  FROM public.company_ticket_inactivity_charges c
  WHERE c.company_id = p_company_id
    AND c.status = 'pending'
  ORDER BY c.reference_month DESC
  LIMIT 1;

  IF v_charge.id IS NULL THEN
    RETURN jsonb_build_object(
      'has_pending_charge', false,
      'is_paid', true
    );
  END IF;

  RETURN jsonb_build_object(
    'has_pending_charge', true,
    'is_paid', false,
    'charge_id', v_charge.id,
    'amount', v_charge.amount,
    'status', v_charge.status,
    'reference_month', v_charge.reference_month
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_ticket_inactivity_notification(
  p_company_id UUID,
  p_reference_month DATE,
  p_notification_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT NULLIF(trim(c.email), '')
  INTO v_email
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_email IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.company_ticket_inactivity_notifications n
    WHERE n.company_id = p_company_id
      AND n.reference_month = date_trunc('month', p_reference_month)::date
      AND n.notification_type = p_notification_type
      AND n.sent_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.company_ticket_inactivity_notifications (
    company_id, reference_month, recipient_email, notification_type, payload
  )
  VALUES (
    p_company_id,
    date_trunc('month', p_reference_month)::date,
    v_email,
    p_notification_type,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (company_id, reference_month, notification_type) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_ticket_inactivity_notifications(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.created_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      n.id,
      n.company_id,
      n.reference_month,
      n.recipient_email,
      n.notification_type,
      n.payload,
      n.created_at,
      c.corporate_name AS company_name,
      c.trade_name
    FROM public.company_ticket_inactivity_notifications n
    INNER JOIN public.companies c ON c.id = n.company_id
    WHERE n.sent_at IS NULL
    ORDER BY n.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) s;

  RETURN jsonb_build_object('success', true, 'notifications', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ticket_inactivity_notification_sent(
  p_notification_id UUID,
  p_resend_id TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_ticket_inactivity_notifications
  SET
    sent_at = CASE WHEN p_error_message IS NULL THEN timezone('utc'::text, now()) ELSE sent_at END,
    resend_id = COALESCE(p_resend_id, resend_id),
    error_message = p_error_message
  WHERE id = p_notification_id;
END;
$$;

-- Atualiza verificação mensal com cobrança + fila de e-mail
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
  v_charges_created INTEGER := 0;
  v_notifications_queued INTEGER := 0;
  v_charge JSONB;
  v_was_blocked BOOLEAN;
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
    SELECT c.id, c.ticket_inactivity_blocked, c.email, c.corporate_name
    FROM public.companies c
    WHERE public.company_requires_paid_ticket_event(c.id)
  LOOP
    v_company_flagged := false;
    v_was_blocked := COALESCE(v_company.ticket_inactivity_blocked, false);

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

      IF NOT v_was_blocked THEN
        PERFORM public.queue_ticket_inactivity_notification(
          v_company.id,
          v_month,
          'blocked',
          jsonb_build_object('events_flagged', v_flagged)
        );
        v_notifications_queued := v_notifications_queued + 1;
      END IF;

      v_charge := public.ensure_ticket_inactivity_charge(v_company.id, v_month);
      IF COALESCE((v_charge->>'skipped')::boolean, false) = false
         AND COALESCE((v_charge->>'already_paid')::boolean, false) = false THEN
        v_charges_created := v_charges_created + 1;
        PERFORM public.queue_ticket_inactivity_notification(
          v_company.id,
          v_month,
          'charge_created',
          jsonb_build_object(
            'charge_id', v_charge->>'charge_id',
            'amount', v_charge->>'amount'
          )
        );
        v_notifications_queued := v_notifications_queued + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reference_month', v_month,
    'events_flagged', v_flagged,
    'companies_blocked', v_companies_blocked,
    'charges_created', v_charges_created,
    'notifications_queued', v_notifications_queued
  );
END;
$$;

-- enforce_billing_plan_on_events com log de bypass Admin Master
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

-- pg_cron: dia 5 de cada mês às 08:00 UTC (~05:00 BRT)
DO $cron$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_cron indisponível neste ambiente; agende run_ticket_inactivity_check manualmente.';
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron: %', SQLERRM;
END
$cron$;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'ticket_inactivity_monthly_check';

    PERFORM cron.schedule(
      'ticket_inactivity_monthly_check',
      '0 8 5 * *',
      $job$SELECT public.run_ticket_inactivity_check();$job$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Não foi possível agendar pg_cron ticket_inactivity_monthly_check: %', SQLERRM;
END
$schedule$;

REVOKE ALL ON FUNCTION public.log_admin_master_bypass(TEXT, TEXT, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_master_bypass_log(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_manager_events_ticket_readiness(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_has_consecutive_ticket_inactivity(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ticket_inactivity_fee_default() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_ticket_inactivity_charge(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_ticket_inactivity_charge_mp_preference(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_ticket_inactivity_charge_payment(UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_ticket_inactivity_charge_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_ticket_inactivity_notification(UUID, DATE, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_ticket_inactivity_notifications(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_ticket_inactivity_notification_sent(UUID, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_admin_master_bypass(TEXT, TEXT, UUID, UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_master_bypass_log(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_manager_events_ticket_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_has_consecutive_ticket_inactivity(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ticket_inactivity_fee_default() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_ticket_inactivity_charge(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_ticket_inactivity_charge_mp_preference(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ticket_inactivity_charge_payment(UUID, TEXT, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_ticket_inactivity_charge_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_ticket_inactivity_notification(UUID, DATE, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_ticket_inactivity_notifications(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_ticket_inactivity_notification_sent(UUID, TEXT, TEXT) TO service_role;
