-- Inscrição gratuita sempre consome 1 pulseira (wristband_analytics) price=0; QR = analytics.id

CREATE OR REPLACE FUNCTION public.register_free_event_with_wristband(
  p_event_id uuid,
  p_full_name text,
  p_cpf text,
  p_age int,
  p_street text,
  p_number text,
  p_neighborhood text,
  p_complement text,
  p_city text,
  p_state text,
  p_phone text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf_digits text;
  v_wa_id uuid;
  v_wb_id uuid;
  v_reg_id uuid;
BEGIN
  v_cpf_digits := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  IF length(v_cpf_digits) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cpf');
  END IF;

  IF EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND is_paid = true) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_free');
  END IF;

  IF EXISTS (
    SELECT 1 FROM event_registrations er
    WHERE er.event_id = p_event_id
      AND regexp_replace(COALESCE(er.cpf, ''), '\D', '', 'g') = v_cpf_digits
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cpf_taken');
  END IF;

  SELECT wa.id, wa.wristband_id
  INTO v_wa_id, v_wb_id
  FROM wristband_analytics wa
  INNER JOIN wristbands w ON w.id = wa.wristband_id
  WHERE w.event_id = p_event_id
    AND w.price = 0
    AND wa.status = 'active'
  ORDER BY w.created_at ASC, wa.sequential_number ASC NULLS LAST, wa.id
  LIMIT 1
  FOR UPDATE OF wa SKIP LOCKED;

  IF v_wa_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_free_wristbands');
  END IF;

  UPDATE wristband_analytics
  SET
    status = 'used',
    event_type = 'free_registration',
    event_data = COALESCE(event_data, '{}'::jsonb) || jsonb_build_object(
      'free_registration_at', to_jsonb(now()),
      'full_name', p_full_name,
      'email', lower(trim(p_email)),
      'cpf', v_cpf_digits
    )
  WHERE id = v_wa_id;

  INSERT INTO event_registrations (
    event_id, full_name, cpf, age, street, number, neighborhood, complement,
    city, state, phone, email, wristband_id, qr_code
  ) VALUES (
    p_event_id,
    trim(p_full_name),
    v_cpf_digits,
    p_age,
    trim(p_street),
    trim(p_number),
    trim(p_neighborhood),
    nullif(trim(COALESCE(p_complement, '')), ''),
    trim(p_city),
    trim(p_state),
    regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'),
    lower(trim(p_email)),
    v_wb_id,
    v_wa_id::text
  )
  RETURNING id INTO v_reg_id;

  IF NOT EXISTS (
    SELECT 1 FROM wristband_analytics WHERE wristband_id = v_wb_id AND status = 'active'
  ) THEN
    UPDATE wristbands SET status = 'used' WHERE id = v_wb_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'qr_code', v_wa_id::text,
    'registration_id', v_reg_id,
    'wristband_id', v_wb_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cpf_taken');
END;
$$;

REVOKE ALL ON FUNCTION public.register_free_event_with_wristband(uuid, text, text, int, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_free_event_with_wristband(uuid, text, text, int, text, text, text, text, text, text, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.register_free_event_with_wristband IS 'Inscrição gratuita: reserva 1 wristband_analytics (preço R$0), status used, qr_code = id do analytics.';
