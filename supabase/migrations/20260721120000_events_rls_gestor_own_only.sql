-- Isolamento de eventos por gestor: gestor PRO só enxerga eventos que criou (created_by).
-- Admin Master continua vendo todos. Vitrine pública (anon + clientes) vê eventos ativos.

CREATE OR REPLACE FUNCTION public.user_is_gestor_pro_for_rls()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tipo_usuario_id = 2
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_gestor_pro_for_rls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_gestor_pro_for_rls() TO authenticated, anon;

DROP POLICY IF EXISTS "events_select_authenticated" ON public.events;

-- Admin Master: leitura global
CREATE POLICY "events_select_admin_master"
ON public.events
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND public.user_is_admin_master_for_rls()
);

-- Gestor PRO: somente eventos criados por ele
CREATE POLICY "events_select_gestor_own"
ON public.events
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND public.user_is_gestor_pro_for_rls()
  AND created_by = auth.uid()
);

-- Vitrine pública: eventos ativos para visitantes e clientes (não gestor/admin)
CREATE POLICY "events_select_public_vitrine"
ON public.events
FOR SELECT
USING (
  COALESCE(is_active, false) = true
  AND (
    auth.role() = 'anon'
    OR (
      auth.uid() IS NOT NULL
      AND NOT public.user_is_admin_master_for_rls()
      AND NOT public.user_is_gestor_pro_for_rls()
    )
  )
);

-- Exclusão: gestor só remove o que criou; admin remove qualquer um
DROP POLICY IF EXISTS "events_delete_owner_or_admin" ON public.events;

CREATE POLICY "events_delete_owner_or_admin"
ON public.events
FOR DELETE
USING (
  auth.uid() IS NOT NULL
  AND (
    public.user_is_admin_master_for_rls()
    OR (
      public.user_is_gestor_pro_for_rls()
      AND created_by = auth.uid()
    )
  )
);

COMMENT ON FUNCTION public.user_is_gestor_pro_for_rls() IS
  'true quando auth.uid() é Gestor PRO (tipo_usuario_id = 2). Usado em RLS de events.';

-- Badge "Faltam ingressos": só eventos do gestor logado (não toda a empresa)
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
    AND (
      public.user_is_admin_master_for_rls()
      OR e.created_by = v_user
    )
    AND COALESCE(e.is_paid, false) = true
    AND COALESCE(e.listing_only, false) = false
    AND COALESCE(e.is_draft, false) = false
    AND COALESCE(e.is_active, false) = false;

  RETURN v_rows;
END;
$$;

