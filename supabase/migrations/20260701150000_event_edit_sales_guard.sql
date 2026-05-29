-- Bloqueio de edição: resumo de vendas/inscrições para o formulário de evento (gestor).

CREATE OR REPLACE FUNCTION public.get_event_edit_sales_guard(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sold_count int;
  v_paid_receivables_count int;
  v_free_registrations_count int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = v_user
        OR public.user_is_admin_master_for_rls()
        OR EXISTS (
          SELECT 1
          FROM public.user_companies uc
          WHERE uc.user_id = v_user
            AND uc.company_id = e.company_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int
  INTO v_sold_count
  FROM public.wristband_analytics wa
  INNER JOIN public.wristbands w ON w.id = wa.wristband_id
  WHERE w.event_id = p_event_id
    AND (
      wa.client_user_id IS NOT NULL
      OR wa.status = 'used'
    );

  SELECT COUNT(*)::int
  INTO v_paid_receivables_count
  FROM public.receivables r
  WHERE r.event_id = p_event_id
    AND r.status = 'paid';

  SELECT COUNT(*)::int
  INTO v_free_registrations_count
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id;

  RETURN jsonb_build_object(
    'sold_count', v_sold_count,
    'paid_receivables_count', v_paid_receivables_count,
    'free_registrations_count', v_free_registrations_count,
    'has_sales',
      (v_sold_count > 0 OR v_paid_receivables_count > 0 OR v_free_registrations_count > 0),
    'min_capacity',
      GREATEST(
        v_sold_count,
        v_free_registrations_count,
        1
      )
  );
END;
$$;

COMMENT ON FUNCTION public.get_event_edit_sales_guard(uuid) IS
  'Contagem de ingressos vendidos/inscrições e flag has_sales para travar edição de lotes no gestor.';

REVOKE ALL ON FUNCTION public.get_event_edit_sales_guard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_edit_sales_guard(uuid) TO authenticated;
