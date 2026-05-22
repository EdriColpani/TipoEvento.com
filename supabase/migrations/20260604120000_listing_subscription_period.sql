-- Assinatura mensalidade vitrine: período de 30 dias a partir do vencimento anterior

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS listing_active_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS listing_last_payment_at TIMESTAMPTZ;

COMMENT ON COLUMN public.companies.listing_active_until IS
  'Fim do período pago (plano listing_monthly). Renovação: +30 dias a partir desta data.';
COMMENT ON COLUMN public.companies.listing_last_payment_at IS
  'Última confirmação de pagamento da mensalidade vitrine.';

-- Estende +30 dias a partir do vencimento anterior (ou agora se primeira vez)
CREATE OR REPLACE FUNCTION public.extend_listing_subscription_period(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_anchor TIMESTAMPTZ;
  v_new_until TIMESTAMPTZ;
BEGIN
  SELECT id, billing_plan, listing_active_until
  INTO v_company
  FROM public.companies
  WHERE id = p_company_id;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  IF v_company.billing_plan IS DISTINCT FROM 'listing_monthly'::public.billing_plan_type THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'reason', 'not_listing_plan');
  END IF;

  v_anchor := COALESCE(v_company.listing_active_until, timezone('utc'::text, now()));
  v_new_until := v_anchor + interval '30 days';

  -- Pagamento após vencimento: se o período calculado já passou, reinicia a partir de agora
  IF v_new_until <= timezone('utc'::text, now()) THEN
    v_new_until := timezone('utc'::text, now()) + interval '30 days';
  END IF;

  UPDATE public.companies
  SET
    listing_active_until = v_new_until,
    listing_last_payment_at = timezone('utc'::text, now())
  WHERE id = p_company_id;

  PERFORM public.refresh_listing_subscription_enforcement(p_company_id);

  RETURN jsonb_build_object(
    'success', true,
    'listing_active_until', v_new_until,
    'listing_last_payment_at', timezone('utc'::text, now())
  );
END;
$$;

-- Fase: active | expiring_soon | due_today | past_due | not_applicable
CREATE OR REPLACE FUNCTION public.get_listing_subscription_phase(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.billing_plan_type;
  v_until TIMESTAMPTZ;
  v_until_date DATE;
  v_today DATE;
  v_days_left INT;
BEGIN
  SELECT billing_plan, listing_active_until
  INTO v_plan, v_until
  FROM public.companies
  WHERE id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('phase', 'not_applicable');
  END IF;

  IF v_plan IS DISTINCT FROM 'listing_monthly'::public.billing_plan_type THEN
    RETURN jsonb_build_object('phase', 'not_applicable', 'billing_plan', v_plan);
  END IF;

  IF v_until IS NULL THEN
    RETURN jsonb_build_object(
      'phase', 'past_due',
      'days_left', 0,
      'listing_active_until', NULL,
      'message', 'Mensalidade não paga. Renove para continuar usando o sistema.'
    );
  END IF;

  v_until_date := (v_until AT TIME ZONE 'America/Sao_Paulo')::date;
  v_today := (timezone('utc'::text, now()) AT TIME ZONE 'America/Sao_Paulo')::date;
  v_days_left := v_until_date - v_today;

  IF v_days_left < 0 THEN
    PERFORM public.refresh_listing_subscription_enforcement(p_company_id);
    RETURN jsonb_build_object(
      'phase', 'past_due',
      'days_left', v_days_left,
      'listing_active_until', v_until,
      'message', 'Assinatura vencida. Renove a mensalidade para liberar o painel.'
    );
  END IF;

  IF v_days_left = 0 THEN
    RETURN jsonb_build_object(
      'phase', 'due_today',
      'days_left', 0,
      'listing_active_until', v_until,
      'message', 'Hoje é o vencimento da assinatura. Renove para evitar bloqueio amanhã.'
    );
  END IF;

  IF v_days_left <= 3 THEN
    RETURN jsonb_build_object(
      'phase', 'expiring_soon',
      'days_left', v_days_left,
      'listing_active_until', v_until,
      'message', format('Sua assinatura vence em %s dia(s). Verifique a renovação.', v_days_left)
    );
  END IF;

  RETURN jsonb_build_object(
    'phase', 'active',
    'days_left', v_days_left,
    'listing_active_until', v_until,
    'message', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.company_listing_subscription_blocks_operations(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phase TEXT;
BEGIN
  v_phase := (public.get_listing_subscription_phase(p_company_id) ->> 'phase');
  RETURN v_phase = 'past_due';
END;
$$;

-- Desativa chaves de validação quando assinatura vencida (reativação manual após pagar)
CREATE OR REPLACE FUNCTION public.refresh_listing_subscription_enforcement(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.company_listing_subscription_blocks_operations(p_company_id) THEN
    RETURN;
  END IF;

  UPDATE public.validation_api_keys vak
  SET is_active = false, updated_at = timezone('utc'::text, now())
  FROM public.events e
  WHERE vak.event_id = e.id
    AND e.company_id = p_company_id
    AND vak.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_listing_monthly_charge_payment(
  p_charge_id UUID,
  p_mp_payment_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge RECORD;
BEGIN
  UPDATE public.company_listing_monthly_charges
  SET
    status = 'paid',
    paid_at = timezone('utc'::text, now()),
    mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
    AND status = 'pending'
  RETURNING * INTO v_charge;

  IF v_charge.id IS NULL THEN
    SELECT * INTO v_charge
    FROM public.company_listing_monthly_charges
    WHERE id = p_charge_id;

    IF v_charge.id IS NULL THEN
      RAISE EXCEPTION 'Cobrança não encontrada.';
    END IF;

    IF v_charge.status = 'paid' THEN
      PERFORM public.extend_listing_subscription_period(v_charge.company_id);
      RETURN jsonb_build_object('success', true, 'status', 'paid', 'idempotent', true);
    END IF;

    RETURN jsonb_build_object('success', false, 'status', v_charge.status);
  END IF;

  PERFORM public.extend_listing_subscription_period(v_charge.company_id);

  RETURN jsonb_build_object('success', true, 'status', 'paid', 'charge_id', v_charge.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_listing_charge_status(
  p_charge_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master.';
  END IF;

  IF p_status NOT IN ('pending', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  UPDATE public.company_listing_monthly_charges
  SET
    status = p_status,
    notes = COALESCE(p_notes, notes),
    paid_at = CASE WHEN p_status = 'paid' THEN timezone('utc'::text, now()) ELSE NULL END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_charge_id
  RETURNING company_id INTO v_company_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Cobrança não encontrada.';
  END IF;

  IF p_status = 'paid' THEN
    PERFORM public.extend_listing_subscription_period(v_company_id);
  ELSIF p_status IN ('pending', 'cancelled') THEN
    PERFORM public.refresh_listing_subscription_enforcement(v_company_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

-- Backfill: empresas listing_monthly com cobrança paga recente
UPDATE public.companies c
SET
  listing_last_payment_at = sub.last_paid,
  listing_active_until = sub.last_paid + interval '30 days'
FROM (
  SELECT
    company_id,
    MAX(paid_at) AS last_paid
  FROM public.company_listing_monthly_charges
  WHERE status = 'paid' AND paid_at IS NOT NULL
  GROUP BY company_id
) sub
WHERE c.id = sub.company_id
  AND c.billing_plan = 'listing_monthly'::public.billing_plan_type
  AND c.listing_active_until IS NULL;

REVOKE ALL ON FUNCTION public.extend_listing_subscription_period(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_listing_subscription_phase(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_listing_subscription_blocks_operations(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_listing_subscription_enforcement(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.extend_listing_subscription_period(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_listing_subscription_phase(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_listing_subscription_blocks_operations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_listing_subscription_enforcement(UUID) TO service_role;
