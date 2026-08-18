-- Guias de imposto Admin Master: base = lucro do sintético fiscal; lançamento e baixa manuais.
SELECT public.security_open_change_window('admin tax guides report', 20);

CREATE TABLE IF NOT EXISTS public.platform_tax_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_type TEXT NOT NULL
    CHECK (tax_type IN ('DAS', 'PIS', 'COFINS', 'ISS', 'IRPJ', 'CSLL', 'INSS', 'DARF', 'OUTRO')),
  description TEXT NOT NULL,
  competence_month DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paid', 'cancelled')),
  profit_base_snapshot NUMERIC(14, 2) NOT NULL DEFAULT 0,
  paid_at DATE,
  paid_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id),
  cancel_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT platform_tax_guides_paid_requires_date CHECK (
    status <> 'paid' OR paid_at IS NOT NULL
  ),
  CONSTRAINT platform_tax_guides_cancel_requires_reason CHECK (
    status <> 'cancelled' OR NULLIF(trim(cancel_reason), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS platform_tax_guides_competence_idx
  ON public.platform_tax_guides (competence_month DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_tax_guides_status_idx
  ON public.platform_tax_guides (status);

ALTER TABLE public.platform_tax_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_tax_guides_admin_all
  ON public.platform_tax_guides
  FOR ALL
  TO authenticated
  USING (public.user_is_admin_master_for_rls())
  WITH CHECK (public.user_is_admin_master_for_rls());

CREATE OR REPLACE FUNCTION public._tax_competence_month(p_competence TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_competence IS NULL OR trim(p_competence) !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Competência inválida. Use AAAA-MM.';
  END IF;
  RETURN to_date(trim(p_competence) || '-01', 'YYYY-MM-DD');
END;
$$;

CREATE OR REPLACE FUNCTION public._tax_profit_base_for_month(p_month DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE := p_month;
  v_end DATE := (date_trunc('month', p_month) + INTERVAL '1 month - 1 day')::date;
  v_json JSONB;
BEGIN
  v_json := public.get_admin_fiscal_synthetic_report(v_start, v_end);
  RETURN round(COALESCE((v_json->'profit'->>'eventfest_profit_total')::numeric, 0), 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_tax_guides(p_competence TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_profit NUMERIC(14, 2) := 0;
  v_items JSONB;
  v_summary JSONB;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF p_competence IS NOT NULL AND trim(p_competence) <> '' THEN
    v_month := public._tax_competence_month(p_competence);
    v_profit := public._tax_profit_base_for_month(v_month);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(g)::jsonb ORDER BY g.due_date ASC, g.created_at ASC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      id,
      tax_type,
      description,
      to_char(competence_month, 'YYYY-MM') AS competence,
      due_date,
      amount,
      status,
      profit_base_snapshot,
      paid_at,
      cancel_reason,
      created_at
    FROM public.platform_tax_guides
    WHERE v_month IS NULL OR competence_month = v_month
  ) g;

  SELECT jsonb_build_object(
    'open_total', COALESCE(SUM(CASE WHEN status = 'open' THEN amount ELSE 0 END), 0),
    'paid_total', COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0),
    'cancelled_total', COALESCE(SUM(CASE WHEN status = 'cancelled' THEN amount ELSE 0 END), 0),
    'guides_count', COUNT(*) FILTER (WHERE status <> 'cancelled')
  )
  INTO v_summary
  FROM public.platform_tax_guides
  WHERE v_month IS NULL OR competence_month = v_month;

  RETURN jsonb_build_object(
    'competence', CASE WHEN v_month IS NULL THEN NULL ELSE to_char(v_month, 'YYYY-MM') END,
    'profit_base', v_profit,
    'items', v_items,
    'summary', v_summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_admin_tax_guide(
  p_tax_type TEXT,
  p_description TEXT,
  p_competence TEXT,
  p_due_date DATE,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE;
  v_type TEXT;
  v_desc TEXT;
  v_amount NUMERIC(14, 2);
  v_id UUID;
  v_profit NUMERIC(14, 2);
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  v_type := upper(trim(COALESCE(p_tax_type, '')));
  v_desc := NULLIF(trim(COALESCE(p_description, '')), '');
  v_month := public._tax_competence_month(p_competence);
  v_amount := round(COALESCE(p_amount, 0), 2);

  IF v_type NOT IN ('DAS', 'PIS', 'COFINS', 'ISS', 'IRPJ', 'CSLL', 'INSS', 'DARF', 'OUTRO') THEN
    RAISE EXCEPTION 'Tipo de imposto inválido.';
  END IF;
  IF v_desc IS NULL THEN
    RAISE EXCEPTION 'Descrição do imposto é obrigatória.';
  END IF;
  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'Vencimento é obrigatório.';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Valor da guia deve ser maior que zero.';
  END IF;

  v_profit := public._tax_profit_base_for_month(v_month);

  INSERT INTO public.platform_tax_guides (
    tax_type,
    description,
    competence_month,
    due_date,
    amount,
    status,
    profit_base_snapshot,
    created_by
  ) VALUES (
    v_type,
    v_desc,
    v_month,
    p_due_date,
    v_amount,
    'open',
    v_profit,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'profit_base_snapshot', v_profit);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_admin_tax_guide_paid(
  p_id UUID,
  p_paid_at DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Guia inválida.';
  END IF;
  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Data de pagamento é obrigatória.';
  END IF;

  SELECT status INTO v_status
  FROM public.platform_tax_guides
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Guia não encontrada.';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'Só é possível baixar guia com status A pagar.';
  END IF;

  UPDATE public.platform_tax_guides
  SET
    status = 'paid',
    paid_at = p_paid_at,
    paid_by = auth.uid(),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'status', 'paid');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_admin_tax_guide(
  p_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_reason TEXT;
BEGIN
  IF NOT public.user_is_admin_master_for_rls() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Guia inválida.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  SELECT status INTO v_status
  FROM public.platform_tax_guides
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Guia não encontrada.';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'Só é possível cancelar guia com status A pagar.';
  END IF;

  UPDATE public.platform_tax_guides
  SET
    status = 'cancelled',
    cancel_reason = v_reason,
    cancelled_at = timezone('utc'::text, now()),
    cancelled_by = auth.uid(),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public._tax_competence_month(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._tax_profit_base_for_month(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_admin_tax_guides(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_admin_tax_guide(TEXT, TEXT, TEXT, DATE, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_admin_tax_guide_paid(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_admin_tax_guide(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_admin_tax_guides(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_admin_tax_guide(TEXT, TEXT, TEXT, DATE, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_admin_tax_guide_paid(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_admin_tax_guide(UUID, TEXT) TO authenticated, service_role;

COMMENT ON TABLE public.platform_tax_guides IS
  'Guias de imposto da EventFest (Admin Master). Base de cálculo = lucro do sintético fiscal na competência.';
