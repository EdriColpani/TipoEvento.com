-- Fase 9 (parcial): catálogo de produtos por estabelecimento para uso no PDV

CREATE TABLE IF NOT EXISTS public.credit_establishment_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.credit_establishments(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NULL,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (establishment_id, name)
);

CREATE INDEX IF NOT EXISTS idx_credit_establishment_products_establishment
  ON public.credit_establishment_products (establishment_id, active, name);

CREATE OR REPLACE FUNCTION public.list_credit_establishment_products(
  p_company_id UUID,
  p_establishment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF p_company_id IS NULL OR p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.credit_establishments ce
    WHERE ce.id = p_establishment_id
      AND ce.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Estabelecimento inválido para esta empresa.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.name ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id,
      p.establishment_id,
      p.company_id,
      p.name,
      p.description,
      p.unit_price,
      p.active,
      p.created_at,
      p.updated_at
    FROM public.credit_establishment_products p
    WHERE p.company_id = p_company_id
      AND p.establishment_id = p_establishment_id
  ) t;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'establishment_id', p_establishment_id,
    'module_enabled', public.credit_module_globally_enabled(),
    'company_allows_credit', public.company_allows_credit_consumption(p_company_id),
    'items', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_credit_establishment_product(
  p_company_id UUID,
  p_establishment_id UUID,
  p_name TEXT,
  p_unit_price NUMERIC,
  p_description TEXT DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_active BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT;
  v_price NUMERIC(12,2);
BEGIN
  IF p_company_id IS NULL OR p_establishment_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF NOT public.company_allows_credit_consumption(p_company_id) THEN
    RAISE EXCEPTION 'Plano comercial da empresa não habilita consumo por crédito.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.credit_establishments ce
    WHERE ce.id = p_establishment_id
      AND ce.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Estabelecimento inválido para esta empresa.';
  END IF;

  v_name := trim(COALESCE(p_name, ''));
  v_price := round(COALESCE(p_unit_price, 0)::numeric, 2);

  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome do produto.';
  END IF;

  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Preço unitário inválido.';
  END IF;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.credit_establishment_products p
    SET
      name = v_name,
      description = NULLIF(trim(COALESCE(p_description, '')), ''),
      unit_price = v_price,
      active = COALESCE(p_active, true),
      updated_at = timezone('utc'::text, now())
    WHERE p.id = p_product_id
      AND p.company_id = p_company_id
      AND p.establishment_id = p_establishment_id
    RETURNING p.id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Produto não encontrado.';
    END IF;
  ELSE
    INSERT INTO public.credit_establishment_products (
      establishment_id,
      company_id,
      name,
      description,
      unit_price,
      active
    ) VALUES (
      p_establishment_id,
      p_company_id,
      v_name,
      NULLIF(trim(COALESCE(p_description, '')), ''),
      v_price,
      COALESCE(p_active, true)
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'product_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_credit_establishment_product_active(
  p_company_id UUID,
  p_establishment_id UUID,
  p_product_id UUID,
  p_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL OR p_establishment_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros inválidos.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  UPDATE public.credit_establishment_products p
  SET
    active = COALESCE(p_active, false),
    updated_at = timezone('utc'::text, now())
  WHERE p.id = p_product_id
    AND p.company_id = p_company_id
    AND p.establishment_id = p_establishment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado.';
  END IF;

  RETURN jsonb_build_object('ok', true, 'active', COALESCE(p_active, false));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_credit_establishment_products(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_credit_establishment_product(UUID, UUID, TEXT, NUMERIC, TEXT, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_credit_establishment_product_active(UUID, UUID, UUID, BOOLEAN) TO authenticated;
