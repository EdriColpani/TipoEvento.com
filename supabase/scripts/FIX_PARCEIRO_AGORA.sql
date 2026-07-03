-- =============================================================================
-- COLE ESTE ARQUIVO INTEIRO NO SQL EDITOR DO SUPABASE (projeto lzsjxepcsgwsnpsjzpcm)
-- Dashboard → SQL → New query → Run
-- =============================================================================

-- 1) Admin Master pode inserir empresa (fallback do frontend se RPC travar)
DROP POLICY IF EXISTS companies_insert_admin_master ON public.companies;
CREATE POLICY companies_insert_admin_master
  ON public.companies
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_admin_master_for_rls());

-- 2) RPC rápida (sem auth.users, sem licença de consumo)
CREATE OR REPLACE FUNCTION public.admin_create_partner_company(
  p_cnpj TEXT,
  p_corporate_name TEXT,
  p_trade_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_owner_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_cnpj TEXT;
  v_owner_email TEXT;
  v_invite_id UUID;
BEGIN
  PERFORM set_config('statement_timeout', '15000', true);

  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Apenas Admin Master pode usar esta função.';
  END IF;

  v_cnpj := regexp_replace(COALESCE(p_cnpj, ''), '\D', '', 'g');
  IF length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ inválido.';
  END IF;

  IF trim(COALESCE(p_corporate_name, '')) = '' THEN
    RAISE EXCEPTION 'Informe a razão social.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.companies c WHERE c.cnpj = v_cnpj) THEN
    RAISE EXCEPTION 'CNPJ já cadastrado.';
  END IF;

  INSERT INTO public.companies (
    cnpj, corporate_name, trade_name, email, phone,
    company_kind, billing_plan, requires_billing_reacceptance
  ) VALUES (
    v_cnpj,
    trim(p_corporate_name),
    NULLIF(trim(COALESCE(p_trade_name, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), ''),
    'partner'::public.company_kind,
    'consumption_or_license'::public.billing_plan_type,
    true
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_billing_plan_history (
    company_id, from_plan, to_plan, changed_by, change_type
  ) VALUES (
    v_company_id, NULL,
    'consumption_or_license'::public.billing_plan_type,
    auth.uid(), 'admin_change'
  );

  v_owner_email := lower(trim(COALESCE(p_owner_email, p_email, '')));
  IF v_owner_email <> '' AND position('@' in v_owner_email) > 0 THEN
    INSERT INTO public.company_member_invites (company_id, email, role, invited_by)
    VALUES (v_company_id, v_owner_email, 'owner', auth.uid())
    ON CONFLICT (company_id, email) DO UPDATE
      SET role = EXCLUDED.role,
          invited_by = EXCLUDED.invited_by,
          accepted_at = NULL,
          created_at = timezone('utc'::text, now())
    RETURNING id INTO v_invite_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_company_id,
    'company_kind', 'partner',
    'billing_plan', 'consumption_or_license',
    'owner_invite', CASE
      WHEN v_invite_id IS NOT NULL THEN jsonb_build_object(
        'ok', true,
        'linked_immediately', false,
        'invite_id', v_invite_id,
        'message', 'Convite registrado. O gestor deve entrar com este e-mail.'
      )
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_partner_company(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 3) Verificação (deve retornar "versao_rapida_ok")
SELECT CASE
  WHEN p.prosrc LIKE '%ensure_consumption_license_charge%'
    OR p.prosrc LIKE '%invite_company_member%'
    THEN 'ERRO: ainda versao LENTA — rode este script de novo'
  WHEN p.prosrc LIKE '%company_member_invites%'
    THEN 'versao_rapida_ok'
  ELSE 'desconhecido — confira manualmente'
END AS status_funcao
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admin_create_partner_company';

-- 4) Gestor parceiro pode confirmar plano Consumo / licença
CREATE OR REPLACE FUNCTION public.billing_plan_selectable_by_gestor(p_plan public.billing_plan_type)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_plan IN (
    'listing_monthly'::public.billing_plan_type,
    'ticket_commission'::public.billing_plan_type,
    'ticket_plus_consumption'::public.billing_plan_type,
    'consumption_or_license'::public.billing_plan_type
  );
$$;

SELECT CASE
  WHEN public.billing_plan_selectable_by_gestor('consumption_or_license'::public.billing_plan_type)
    THEN 'plano_consumo_liberado_ok'
  ELSE 'ERRO: rode a migration 20260730130000_fix_partner_billing_plan_confirm.sql'
END AS status_plano_parceiro;

-- 5) RPC pedidos PDV: profiles não tem full_name
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
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'Empresa inválida.'; END IF;
  IF NOT public.user_manages_credit_company(p_company_id) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT i.id, i.client_user_id, i.establishment_id, ce.name AS establishment_name,
      i.status, i.gross_amount, i.biometric_required,
      (i.biometric_confirmed_at IS NOT NULL) AS biometric_confirmed,
      i.spend_order_id, i.created_at, i.updated_at,
      (SELECT COALESCE(jsonb_agg(row_to_json(ii)::jsonb ORDER BY ii.product_name ASC), '[]'::jsonb)
       FROM (SELECT x.product_id, x.product_name, x.quantity, x.unit_price, x.line_total
             FROM public.credit_consumption_intent_items x WHERE x.intent_id = i.id) ii) AS items,
      (SELECT COALESCE(jsonb_agg(row_to_json(hh)::jsonb ORDER BY hh.created_at DESC), '[]'::jsonb)
       FROM (SELECT h.id, h.from_status, h.to_status, h.source, h.notes, h.created_at, h.changed_by_user_id,
             COALESCE(NULLIF(trim(CONCAT(pf.first_name, ' ', pf.last_name)), ''),
                      NULLIF(trim(u.email), ''), h.changed_by_user_id::text, 'Sistema') AS changed_by_label
             FROM public.credit_consumption_intent_status_history h
             LEFT JOIN public.profiles pf ON pf.id = h.changed_by_user_id
             LEFT JOIN auth.users u ON u.id = h.changed_by_user_id
             WHERE h.intent_id = i.id) hh) AS status_history
    FROM public.credit_consumption_intents i
    JOIN public.credit_establishments ce ON ce.id = i.establishment_id
    WHERE i.company_id = p_company_id AND (v_status IS NULL OR i.status = v_status)
    ORDER BY i.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('company_id', p_company_id, 'items', v_rows);
END;
$$;
