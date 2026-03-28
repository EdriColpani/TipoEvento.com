-- Prazo de vendas/inscrições: até o instante de início do evento (data + hora em America/Sao_Paulo).

CREATE OR REPLACE FUNCTION public.event_accepts_new_sales(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_time_str text;
  v_t time;
  v_start timestamptz;
BEGIN
  SELECT
    e.date::date,
    trim(coalesce(e.time::text, ''))
  INTO v_date, v_time_str
  FROM public.events e
  WHERE e.id = p_event_id;

  IF v_date IS NULL THEN
    RETURN false;
  END IF;

  IF v_time_str IS NULL OR v_time_str = '' THEN
    v_t := time '00:00:00';
  ELSE
    BEGIN
      v_t := v_time_str::time;
    EXCEPTION
      WHEN OTHERS THEN
        v_t := time '00:00:00';
    END;
  END IF;

  v_start := ((v_date::timestamp + v_t) AT TIME ZONE 'America/Sao_Paulo');

  RETURN (now() < v_start);
END;
$$;

COMMENT ON FUNCTION public.event_accepts_new_sales(uuid) IS
  'true enquanto now() UTC for antes do início do evento (events.date + events.time interpretados em America/Sao_Paulo).';

REVOKE ALL ON FUNCTION public.event_accepts_new_sales(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_accepts_new_sales(uuid) TO anon, authenticated, service_role;

-- Inscrição gratuita: encerrada após o início do evento
CREATE OR REPLACE FUNCTION public.register_free_event_with_wristband(
  p_event_id uuid,
  p_turma_id uuid,
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
  v_code_wristbands text;

  v_turma_capacity integer;
  v_turma_used_count integer;
BEGIN
  v_cpf_digits := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  IF length(v_cpf_digits) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cpf');
  END IF;

  IF EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND is_paid = true) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_free');
  END IF;

  IF EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND is_active IS NOT TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_inactive');
  END IF;

  IF NOT public.event_accepts_new_sales(p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_sales_closed');
  END IF;

  SELECT t.capacity
  INTO v_turma_capacity
  FROM public.event_turmas t
  WHERE t.id = p_turma_id
    AND t.event_id = p_event_id
  FOR UPDATE;

  IF v_turma_capacity IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_turma');
  END IF;

  SELECT count(*)
  INTO v_turma_used_count
  FROM public.event_registrations er
  WHERE er.turma_id = p_turma_id;

  IF v_turma_used_count >= v_turma_capacity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'turma_full');
  END IF;

  SELECT wa.id, wa.wristband_id, wa.code_wristbands
  INTO v_wa_id, v_wb_id, v_code_wristbands
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

  IF EXISTS (
    SELECT 1
    FROM event_registrations er
    WHERE er.event_id = p_event_id
      AND regexp_replace(COALESCE(er.cpf, ''), '\D', '', 'g') = v_cpf_digits
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cpf_taken');
  END IF;

  INSERT INTO event_registrations (
    event_id, turma_id, full_name, cpf, age, street, number, neighborhood, complement,
    city, state, phone, email, wristband_id, qr_code
  ) VALUES (
    p_event_id,
    p_turma_id,
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
    SELECT 1 FROM wristband_analytics
    WHERE wristband_id = v_wb_id AND status = 'active'
  ) THEN
    UPDATE wristbands SET status = 'used' WHERE id = v_wb_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'qr_code', v_wa_id::text,
    'wristband_code', COALESCE(v_code_wristbands, ''),
    'registration_id', v_reg_id,
    'wristband_id', v_wb_id,
    'turma_id', p_turma_id
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cpf_taken');
END;
$$;

REVOKE ALL ON FUNCTION public.register_free_event_with_wristband(uuid, uuid, text, text, int, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_free_event_with_wristband(uuid, uuid, text, text, int, text, text, text, text, text, text, text, text) TO anon, authenticated;
