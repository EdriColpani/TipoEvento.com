-- Permite ao gestor liberar vínculo do pacote cortesia (ex.: teste com conta errada).

CREATE OR REPLACE FUNCTION public.reset_complimentary_bundle_holder(p_bundle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle public.complimentary_bundles%ROWTYPE;
  v_redeemed INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = p_bundle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF NOT public.user_can_manage_event(v_bundle.event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_bundle.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bundle_not_active', 'status', v_bundle.status);
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_redeemed
  FROM public.complimentary_bundle_seats s
  WHERE s.bundle_id = v_bundle.id
    AND s.status = 'redeemed';

  IF v_redeemed > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'seats_already_redeemed',
      'redeemed_count', v_redeemed
    );
  END IF;

  IF v_bundle.holder_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_unlinked', true);
  END IF;

  UPDATE public.complimentary_bundles
  SET
    holder_user_id = NULL,
    holder_claimed_at = NULL
  WHERE id = v_bundle.id;

  RETURN jsonb_build_object('ok', true, 'reset', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_complimentary_bundle_holder(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_complimentary_bundle_holder(UUID) TO authenticated;

COMMENT ON FUNCTION public.reset_complimentary_bundle_holder(UUID) IS
  'Gestor libera vínculo do destinatário para o pacote ser reclamado por outra conta (sem ingressos resgatados).';
