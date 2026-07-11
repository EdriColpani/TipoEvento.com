-- Ciclo de vida: 1 dia após date+time → evento encerrado (is_active=false).
-- Gestor não reativa; só Admin Master.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS lifecycle_ended_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.events.lifecycle_ended_at IS
  'Preenchido quando o evento é encerrado automaticamente (1 dia após date+time). Distinto de auto_deactivated_at (inatividade comercial).';

-- Jobs de encerramento não devem ser bloqueados por reaceitação de contrato.
CREATE OR REPLACE FUNCTION public.enforce_event_contract_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_contract public.event_contracts%ROWTYPE;
BEGIN
  IF current_setting('app.bypass_event_contract_enforce', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  -- Desativar / marcar encerrado sem alterar dados comerciais
  IF TG_OP = 'UPDATE'
     AND NEW.is_active IS FALSE
     AND COALESCE(OLD.is_active, false) IS DISTINCT FROM FALSE
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.time IS NOT DISTINCT FROM OLD.time
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.contract_id IS NOT DISTINCT FROM OLD.contract_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_company
  FROM public.companies c
  WHERE c.id = NEW.company_id;

  IF v_company.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_company.requires_billing_reacceptance, false) THEN
    RAISE EXCEPTION
      'Há uma nova versão do contrato do plano. Confirme em Perfil da Empresa → Plano e cobrança antes de criar ou atualizar eventos.';
  END IF;

  IF v_company.billing_plan IS NOT NULL
     AND v_company.billing_plan_accepted_at IS NOT NULL
     AND v_company.billing_contract_id IS NOT NULL
  THEN
    SELECT * INTO v_contract
    FROM public.event_contracts ec
    WHERE ec.id = v_company.billing_contract_id;

    IF v_contract.id IS NOT NULL THEN
      NEW.contract_id := v_contract.id;
      NEW.contract_version := v_contract.version;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.contract_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_contract
  FROM public.event_contracts ec
  WHERE ec.id = NEW.contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contrato do evento não encontrado.';
  END IF;

  IF NEW.contract_version IS NULL OR btrim(NEW.contract_version) = '' THEN
    NEW.contract_version := v_contract.version;
  ELSIF NEW.contract_version IS DISTINCT FROM v_contract.version THEN
    RAISE EXCEPTION
      'A versão do contrato informada (%) não corresponde ao contrato selecionado (%).',
      NEW.contract_version, v_contract.version;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_lifecycle_end_at(
  p_date DATE,
  p_time TIME WITHOUT TIME ZONE DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    ((COALESCE(p_date, '1970-01-01'::date)::text || ' ' ||
      COALESCE(to_char(p_time, 'HH24:MI:SS'), '00:00:00'))::timestamp
      AT TIME ZONE 'America/Sao_Paulo')
    + INTERVAL '1 day'
  );
$$;

COMMENT ON FUNCTION public.event_lifecycle_end_at(DATE, TIME) IS
  'Instante (America/Sao_Paulo) em que o evento encerra: início (date+time) + 1 dia.';

CREATE OR REPLACE FUNCTION public.is_event_lifecycle_ended(
  p_date DATE,
  p_time TIME WITHOUT TIME ZONE DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT timezone('utc', now())
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_date IS NULL THEN false
    ELSE p_now >= public.event_lifecycle_end_at(p_date, p_time)
  END;
$$;

CREATE OR REPLACE FUNCTION public.run_past_events_lifecycle_deactivate()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_event RECORD;
  v_deactivated INTEGER := 0;
  v_events JSONB := '[]'::jsonb;
BEGIN
  -- Evita bloqueio do trigger de contrato (ex.: requires_billing_reacceptance).
  PERFORM set_config('app.bypass_event_contract_enforce', '1', true);

  FOR v_event IN
    SELECT e.id, e.title, e.date::date AS event_date, e.time
    FROM public.events e
    WHERE COALESCE(e.is_active, false) = true
      AND e.date IS NOT NULL
      AND public.is_event_lifecycle_ended(e.date::date, e.time, v_now)
  LOOP
    UPDATE public.events ev
    SET
      is_active = false,
      lifecycle_ended_at = COALESCE(ev.lifecycle_ended_at, v_now)
    WHERE ev.id = v_event.id
      AND COALESCE(ev.is_active, false) = true;

    IF FOUND THEN
      v_deactivated := v_deactivated + 1;
      v_events := v_events || jsonb_build_array(
        jsonb_build_object(
          'event_id', v_event.id,
          'title', v_event.title,
          'event_date', v_event.event_date
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deactivated_count', v_deactivated,
    'events', v_events
  );
END;
$$;

COMMENT ON FUNCTION public.run_past_events_lifecycle_deactivate() IS
  'Desativa eventos ativos cujo início (date+time) + 1 dia já passou.';

CREATE OR REPLACE FUNCTION public.admin_run_past_events_lifecycle_deactivate()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode executar este job.';
  END IF;
  RETURN public.run_past_events_lifecycle_deactivate();
END;
$$;

-- Bloqueia reativação (is_active true) por não-admin após encerramento.
CREATE OR REPLACE FUNCTION public.enforce_event_lifecycle_reactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended BOOLEAN;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Só interessa quando alguém tenta ligar is_active
  IF NOT (NEW.is_active IS TRUE AND COALESCE(OLD.is_active, false) IS DISTINCT FROM TRUE) THEN
    RETURN NEW;
  END IF;

  v_ended := public.is_event_lifecycle_ended(NEW.date::date, NEW.time)
    OR NEW.lifecycle_ended_at IS NOT NULL;

  IF v_ended AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION
      'EVENT_LIFECYCLE_ENDED: Este evento já foi realizado. Somente o administrador pode reativá-lo.';
  END IF;

  -- Admin reativando: limpa marca de encerramento (precisa data futura para não cair de novo no job)
  IF v_ended AND public.user_is_admin_master_for_rls() THEN
    NEW.lifecycle_ended_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_lifecycle_reactivation ON public.events;
CREATE TRIGGER trg_enforce_event_lifecycle_reactivation
  BEFORE UPDATE OF is_active, date, time, lifecycle_ended_at ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_lifecycle_reactivation();

-- Bloqueia alteração de campos comerciais do evento encerrado por não-admin.
CREATE OR REPLACE FUNCTION public.enforce_event_lifecycle_edit_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended BOOLEAN;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Jobs (cron/service) e Admin Master passam
  IF auth.uid() IS NULL OR public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  v_ended := public.is_event_lifecycle_ended(OLD.date::date, OLD.time)
    OR OLD.lifecycle_ended_at IS NOT NULL;

  IF NOT v_ended THEN
    RETURN NEW;
  END IF;

  -- Permite só desativar / marcar encerrado (sem alterar dados do evento)
  IF NEW.is_active IS FALSE
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.time IS NOT DISTINCT FROM OLD.time
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.ticket_price IS NOT DISTINCT FROM OLD.ticket_price
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.address IS NOT DISTINCT FROM OLD.address
     AND NEW.capacity IS NOT DISTINCT FROM OLD.capacity
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.min_age IS NOT DISTINCT FROM OLD.min_age
     AND NEW.duration IS NOT DISTINCT FROM OLD.duration
     AND NEW.is_draft IS NOT DISTINCT FROM OLD.is_draft
     AND NEW.listing_only IS NOT DISTINCT FROM OLD.listing_only
     AND NEW.is_paid IS NOT DISTINCT FROM OLD.is_paid
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'EVENT_LIFECYCLE_ENDED: Evento encerrado — alterações só pelo administrador.';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_lifecycle_edit_lock ON public.events;
CREATE TRIGGER trg_enforce_event_lifecycle_edit_lock
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_lifecycle_edit_lock();

-- Bloqueia alteração de tipos/lotes (wristbands) de evento encerrado por não-admin.
CREATE OR REPLACE FUNCTION public.enforce_wristband_lifecycle_edit_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE;
  v_time TIME WITHOUT TIME ZONE;
  v_ended_at TIMESTAMPTZ;
  v_event_id UUID;
BEGIN
  IF public.user_is_admin_master_for_rls() OR auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_event_id := COALESCE(NEW.event_id, OLD.event_id);

  SELECT e.date::date, e.time, e.lifecycle_ended_at
  INTO v_date, v_time, v_ended_at
  FROM public.events e
  WHERE e.id = v_event_id;

  IF v_date IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF public.is_event_lifecycle_ended(v_date, v_time) OR v_ended_at IS NOT NULL THEN
    RAISE EXCEPTION
      'EVENT_LIFECYCLE_ENDED: Ingressos de evento encerrado só podem ser alterados pelo administrador.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_wristband_lifecycle_edit_lock ON public.wristbands;
CREATE TRIGGER trg_enforce_wristband_lifecycle_edit_lock
  BEFORE UPDATE OR DELETE ON public.wristbands
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_wristband_lifecycle_edit_lock();

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'past_events_lifecycle_deactivate_hourly';

      PERFORM cron.schedule(
        'past_events_lifecycle_deactivate_hourly',
        '15 * * * *',
        $cmd$SELECT public.run_past_events_lifecycle_deactivate();$cmd$
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron past_events_lifecycle_deactivate_hourly: %', SQLERRM;
    END;
  END IF;
END;
$cron$;

-- Encerra imediatamente o que já passou (backfill).
SELECT public.run_past_events_lifecycle_deactivate();

REVOKE ALL ON FUNCTION public.event_lifecycle_end_at(DATE, TIME) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_event_lifecycle_ended(DATE, TIME, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_past_events_lifecycle_deactivate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_run_past_events_lifecycle_deactivate() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_lifecycle_end_at(DATE, TIME) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.is_event_lifecycle_ended(DATE, TIME, TIMESTAMPTZ) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.run_past_events_lifecycle_deactivate() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_run_past_events_lifecycle_deactivate() TO authenticated;
