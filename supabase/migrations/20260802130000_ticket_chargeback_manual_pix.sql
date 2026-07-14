-- Cobrança de chargeback de ingresso para gestores ticket-only (PIX/TED manual)

ALTER TABLE public.manager_ticket_chargeback_debt
  ADD COLUMN IF NOT EXISTS recovery_mode TEXT NOT NULL DEFAULT 'manual_pix'
    CHECK (recovery_mode IN ('manual_pix', 'credit_settlement_offset')),
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_notes TEXT;

COMMENT ON COLUMN public.manager_ticket_chargeback_debt.recovery_mode IS
  'manual_pix = gestor devolve PIX/TED à EventFest; credit_settlement_offset = abate no repasse D+1 de crédito.';

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS ticket_chargeback_pix_key TEXT,
  ADD COLUMN IF NOT EXISTS ticket_chargeback_pix_holder TEXT,
  ADD COLUMN IF NOT EXISTS ticket_chargeback_payment_instructions TEXT;

COMMENT ON COLUMN public.system_billing_settings.ticket_chargeback_pix_key IS
  'Chave PIX EventFest para recebimento de chargeback de ingresso (gestor ticket-only).';
COMMENT ON COLUMN public.system_billing_settings.ticket_chargeback_pix_holder IS
  'Nome do recebedor exibido ao gestor na cobrança de chargeback.';
COMMENT ON COLUMN public.system_billing_settings.ticket_chargeback_payment_instructions IS
  'Instruções extras (TED, banco, etc.) para devolução de chargeback de ingresso.';

-- Backfill: plano com crédito → offset; demais → manual_pix
UPDATE public.manager_ticket_chargeback_debt d
SET recovery_mode = CASE
  WHEN c.billing_plan::text IN ('ticket_plus_consumption', 'consumption_or_license')
    THEN 'credit_settlement_offset'
  ELSE 'manual_pix'
END
FROM public.companies c
WHERE c.id = d.company_id
  AND d.status IN ('open', 'partial', 'settled', 'waived');

CREATE OR REPLACE FUNCTION public.company_ticket_chargeback_recovery_mode(p_company_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.billing_plan::text IN ('ticket_plus_consumption', 'consumption_or_license')
      THEN 'credit_settlement_offset'
    ELSE 'manual_pix'
  END
  FROM public.companies c
  WHERE c.id = p_company_id;
$$;

REVOKE ALL ON FUNCTION public.company_ticket_chargeback_recovery_mode(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_ticket_chargeback_recovery_mode(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_ticket_chargeback_recovery_mode(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_ticket_chargeback_payment_instructions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.system_billing_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.system_billing_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'pix_key', NULLIF(trim(COALESCE(v_row.ticket_chargeback_pix_key, '')), ''),
    'pix_holder', NULLIF(trim(COALESCE(v_row.ticket_chargeback_pix_holder, '')), ''),
    'instructions', NULLIF(trim(COALESCE(v_row.ticket_chargeback_payment_instructions, '')), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_chargeback_payment_instructions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ticket_chargeback_payment_instructions() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_ticket_chargeback_payment_instructions(
  p_pix_key TEXT DEFAULT NULL,
  p_pix_holder TEXT DEFAULT NULL,
  p_instructions TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Somente Admin Master.';
  END IF;

  INSERT INTO public.system_billing_settings (id)
  VALUES (1)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.system_billing_settings
  SET
    ticket_chargeback_pix_key = CASE
      WHEN p_pix_key IS NULL THEN ticket_chargeback_pix_key
      ELSE NULLIF(trim(p_pix_key), '')
    END,
    ticket_chargeback_pix_holder = CASE
      WHEN p_pix_holder IS NULL THEN ticket_chargeback_pix_holder
      ELSE NULLIF(trim(p_pix_holder), '')
    END,
    ticket_chargeback_payment_instructions = CASE
      WHEN p_instructions IS NULL THEN ticket_chargeback_payment_instructions
      ELSE NULLIF(trim(p_instructions), '')
    END
  WHERE id = 1;

  RETURN public.get_ticket_chargeback_payment_instructions();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_ticket_chargeback_payment_instructions(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_ticket_chargeback_payment_instructions(TEXT, TEXT, TEXT) TO authenticated;
