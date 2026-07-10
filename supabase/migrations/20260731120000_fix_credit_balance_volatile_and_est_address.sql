-- get_client_credit_balance era STABLE mas chama ensure (INSERT) → PostgREST read-only / 405.
-- Endereço em estabelecimentos para rota no mapa da carteira do cliente.

ALTER TABLE public.credit_establishments
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS address_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS address_lng DOUBLE PRECISION;

CREATE OR REPLACE FUNCTION public.get_client_credit_balance(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_row public.client_credit_accounts%ROWTYPE;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF v_uid IS DISTINCT FROM auth.uid()
     AND NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  PERFORM public.ensure_client_credit_account(v_uid);

  SELECT * INTO v_row FROM public.client_credit_accounts WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'user_id', v_uid,
    'balance', COALESCE(v_row.balance_cached, 0),
    'currency', COALESCE(v_row.currency, 'BRL'),
    'status', COALESCE(v_row.status, 'active')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_credit_acceptance_network()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events JSONB := '[]'::jsonb;
  v_establishments JSONB := '[]'::jsonb;
  v_has_events BOOLEAN;
  v_has_est_col BOOLEAN;
  v_module BOOLEAN;
BEGIN
  v_module := public.credit_module_globally_enabled();

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'events'
  ) INTO v_has_events;

  IF v_has_events THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'events'
        AND column_name = 'credit_consumption_enabled'
    ) INTO v_has_est_col;

    IF v_has_est_col THEN
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.event_date ASC, t.title ASC), '[]'::jsonb)
      INTO v_events
      FROM (
        SELECT
          e.id AS event_id,
          e.title,
          e.date AS event_date,
          e.time AS event_time,
          e.location,
          e.address,
          e.address_lat,
          e.address_lng,
          e.credit_consumption_enabled,
          c.id AS company_id,
          c.corporate_name AS company_name
        FROM public.events e
        INNER JOIN public.companies c ON c.id = e.company_id
        WHERE COALESCE(e.is_active, true) = true
          AND COALESCE(e.credit_consumption_enabled, false) = true
          AND public.company_allows_credit_consumption(c.id)
      ) t;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'credit_establishments'
  ) THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
    INTO v_establishments
    FROM (
      SELECT
        ce.id AS establishment_id,
        ce.name,
        ce.event_id,
        ce.company_id,
        c.corporate_name AS company_name,
        e.title AS event_title,
        COALESCE(NULLIF(trim(ce.address), ''), e.address) AS address,
        COALESCE(ce.address_lat, e.address_lat) AS address_lat,
        COALESCE(ce.address_lng, e.address_lng) AS address_lng,
        COALESCE(NULLIF(trim(e.location), ''), NULLIF(trim(ce.address), ''), e.address) AS location
      FROM public.credit_establishments ce
      INNER JOIN public.companies c ON c.id = ce.company_id
      LEFT JOIN public.events e ON e.id = ce.event_id
      WHERE ce.active = true
        AND ce.credit_acceptance_enabled = true
        AND public.company_allows_credit_consumption(c.id)
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'module_enabled', v_module,
    'events', v_events,
    'establishments', v_establishments,
    'message', CASE
      WHEN NOT v_module THEN
        'Novas recargas pausadas; pontos abaixo aceitam crédito já existente na carteira.'
      ELSE NULL
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_company_credit_establishments(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      ce.id,
      ce.company_id,
      ce.event_id,
      ce.name,
      ce.address,
      ce.address_lat,
      ce.address_lng,
      ce.credit_acceptance_enabled,
      ce.active,
      ce.created_at,
      e.title AS event_title
    FROM public.credit_establishments ce
    LEFT JOIN public.events e ON e.id = ce.event_id
    WHERE ce.company_id = p_company_id
  ) t;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'module_enabled', public.credit_module_globally_enabled(),
    'company_allows_credit', public.company_allows_credit_consumption(p_company_id),
    'items', v_rows
  );
END;
$$;

DROP FUNCTION IF EXISTS public.save_credit_establishment(UUID, TEXT, UUID, UUID, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.save_credit_establishment(
  p_company_id UUID,
  p_name TEXT,
  p_event_id UUID DEFAULT NULL,
  p_establishment_id UUID DEFAULT NULL,
  p_credit_acceptance_enabled BOOLEAN DEFAULT true,
  p_active BOOLEAN DEFAULT true,
  p_address TEXT DEFAULT NULL,
  p_address_lat DOUBLE PRECISION DEFAULT NULL,
  p_address_lng DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT;
  v_address TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_establishments(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar estabelecimentos.';
  END IF;

  IF NOT public.credit_module_globally_enabled() THEN
    RAISE EXCEPTION 'Módulo de créditos EventFest indisponível.';
  END IF;

  IF NOT public.company_allows_credit_consumption(p_company_id) THEN
    RAISE EXCEPTION 'Plano comercial da empresa não habilita consumo por crédito.';
  END IF;

  v_name := trim(COALESCE(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome do estabelecimento.';
  END IF;

  v_address := NULLIF(trim(COALESCE(p_address, '')), '');

  IF p_event_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = p_event_id AND e.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Evento inválido para esta empresa.';
    END IF;
  END IF;

  IF p_establishment_id IS NOT NULL THEN
    UPDATE public.credit_establishments ce
    SET
      name = v_name,
      event_id = p_event_id,
      credit_acceptance_enabled = COALESCE(p_credit_acceptance_enabled, true),
      active = COALESCE(p_active, true),
      address = v_address,
      address_lat = p_address_lat,
      address_lng = p_address_lng
    WHERE ce.id = p_establishment_id
      AND ce.company_id = p_company_id
    RETURNING ce.id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Estabelecimento não encontrado.';
    END IF;
  ELSE
    INSERT INTO public.credit_establishments (
      company_id,
      event_id,
      name,
      credit_acceptance_enabled,
      active,
      address,
      address_lat,
      address_lng
    ) VALUES (
      p_company_id,
      p_event_id,
      v_name,
      COALESCE(p_credit_acceptance_enabled, true),
      COALESCE(p_active, true),
      v_address,
      p_address_lat,
      p_address_lng
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'establishment_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_credit_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_credit_acceptance_network() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_company_credit_establishments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_credit_establishment(UUID, TEXT, UUID, UUID, BOOLEAN, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
