-- profiles não tem full_name nem email — usar first_name/last_name + auth.users.email

CREATE OR REPLACE FUNCTION public.list_manager_credit_consumption_intents(
  p_company_id UUID,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_status TEXT := NULLIF(trim(COALESCE(p_status, '')), '');
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      i.id,
      i.client_user_id,
      i.establishment_id,
      ce.name AS establishment_name,
      i.status,
      i.gross_amount,
      i.biometric_required,
      (i.biometric_confirmed_at IS NOT NULL) AS biometric_confirmed,
      i.spend_order_id,
      i.created_at,
      i.updated_at,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(ii)::jsonb ORDER BY ii.product_name ASC), '[]'::jsonb)
        FROM (
          SELECT
            x.product_id,
            x.product_name,
            x.quantity,
            x.unit_price,
            x.line_total
          FROM public.credit_consumption_intent_items x
          WHERE x.intent_id = i.id
        ) ii
      ) AS items,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(hh)::jsonb ORDER BY hh.created_at DESC), '[]'::jsonb)
        FROM (
          SELECT
            h.id,
            h.from_status,
            h.to_status,
            h.source,
            h.notes,
            h.created_at,
            h.changed_by_user_id,
            COALESCE(
              NULLIF(trim(CONCAT(pf.first_name, ' ', pf.last_name)), ''),
              NULLIF(trim(u.email), ''),
              h.changed_by_user_id::text,
              'Sistema'
            ) AS changed_by_label
          FROM public.credit_consumption_intent_status_history h
          LEFT JOIN public.profiles pf ON pf.id = h.changed_by_user_id
          LEFT JOIN auth.users u ON u.id = h.changed_by_user_id
          WHERE h.intent_id = i.id
        ) hh
      ) AS status_history
    FROM public.credit_consumption_intents i
    JOIN public.credit_establishments ce ON ce.id = i.establishment_id
    WHERE i.company_id = p_company_id
      AND (v_status IS NULL OR i.status = v_status)
    ORDER BY i.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'items', v_rows
  );
END;
$$;
