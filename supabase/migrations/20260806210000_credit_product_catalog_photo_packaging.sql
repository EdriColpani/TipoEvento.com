-- Catálogo de produtos: foto, embalagem (unidade/caixa) e quantidades.
SELECT public.security_open_change_window('credit product catalog photo packaging storage policies', 15);

ALTER TABLE public.credit_establishment_products
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS packaging_type TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS units_per_box INTEGER,
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_establishment_products_packaging_type_check'
  ) THEN
    ALTER TABLE public.credit_establishment_products
      ADD CONSTRAINT credit_establishment_products_packaging_type_check
      CHECK (packaging_type IN ('unit', 'box'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_establishment_products_units_per_box_check'
  ) THEN
    ALTER TABLE public.credit_establishment_products
      ADD CONSTRAINT credit_establishment_products_units_per_box_check
      CHECK (units_per_box IS NULL OR units_per_box > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_establishment_products_quantity_check'
  ) THEN
    ALTER TABLE public.credit_establishment_products
      ADD CONSTRAINT credit_establishment_products_quantity_check
      CHECK (quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_establishment_products_packaging_consistency_check'
  ) THEN
    ALTER TABLE public.credit_establishment_products
      ADD CONSTRAINT credit_establishment_products_packaging_consistency_check
      CHECK (
        (packaging_type = 'unit' AND units_per_box IS NULL)
        OR (packaging_type = 'box' AND units_per_box IS NOT NULL AND units_per_box > 0)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.credit_establishment_products.image_url IS
  'URL pública da foto do produto (bucket credit-product-images).';
COMMENT ON COLUMN public.credit_establishment_products.packaging_type IS
  'unit = vendido/estoque em unidades; box = em caixas.';
COMMENT ON COLUMN public.credit_establishment_products.units_per_box IS
  'Unidades por caixa (obrigatório quando packaging_type = box).';
COMMENT ON COLUMN public.credit_establishment_products.quantity IS
  'Quantidade informada: unidades (unit) ou número de caixas (box).';

-- Bucket público para foto do produto
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'credit-product-images',
  'credit-product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "credit_product_images_public_read" ON storage.objects;
CREATE POLICY "credit_product_images_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'credit-product-images');

DROP POLICY IF EXISTS "credit_product_images_manager_insert" ON storage.objects;
CREATE POLICY "credit_product_images_manager_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'credit-product-images'
  AND (
    public.user_is_admin_master_for_rls()
    OR public.user_manages_credit_company(((storage.foldername(name))[1])::uuid)
  )
);

DROP POLICY IF EXISTS "credit_product_images_manager_update" ON storage.objects;
CREATE POLICY "credit_product_images_manager_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'credit-product-images'
  AND (
    public.user_is_admin_master_for_rls()
    OR public.user_manages_credit_company(((storage.foldername(name))[1])::uuid)
  )
)
WITH CHECK (
  bucket_id = 'credit-product-images'
  AND (
    public.user_is_admin_master_for_rls()
    OR public.user_manages_credit_company(((storage.foldername(name))[1])::uuid)
  )
);

DROP POLICY IF EXISTS "credit_product_images_manager_delete" ON storage.objects;
CREATE POLICY "credit_product_images_manager_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'credit-product-images'
  AND (
    public.user_is_admin_master_for_rls()
    OR public.user_manages_credit_company(((storage.foldername(name))[1])::uuid)
  )
);

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
      p.image_url,
      p.packaging_type,
      p.units_per_box,
      p.quantity,
      CASE
        WHEN p.packaging_type = 'box' THEN COALESCE(p.units_per_box, 0) * COALESCE(p.quantity, 0)
        ELSE COALESCE(p.quantity, 0)
      END AS total_units,
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

DROP FUNCTION IF EXISTS public.save_credit_establishment_product(UUID, UUID, TEXT, NUMERIC, TEXT, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.save_credit_establishment_product(
  p_company_id UUID,
  p_establishment_id UUID,
  p_name TEXT,
  p_unit_price NUMERIC,
  p_description TEXT DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_active BOOLEAN DEFAULT true,
  p_image_url TEXT DEFAULT NULL,
  p_packaging_type TEXT DEFAULT 'unit',
  p_units_per_box INTEGER DEFAULT NULL,
  p_quantity INTEGER DEFAULT 0
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
  v_packaging TEXT;
  v_units_per_box INTEGER;
  v_quantity INTEGER;
  v_image TEXT;
  v_total INTEGER;
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
  v_packaging := lower(trim(COALESCE(p_packaging_type, 'unit')));
  v_quantity := COALESCE(p_quantity, 0);
  v_image := NULLIF(trim(COALESCE(p_image_url, '')), '');

  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome do produto.';
  END IF;

  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Preço unitário inválido.';
  END IF;

  IF v_packaging NOT IN ('unit', 'box') THEN
    RAISE EXCEPTION 'Tipo de embalagem inválido. Use unidade ou caixa.';
  END IF;

  IF v_quantity < 0 THEN
    RAISE EXCEPTION 'Quantidade inválida.';
  END IF;

  IF v_packaging = 'box' THEN
    v_units_per_box := p_units_per_box;
    IF v_units_per_box IS NULL OR v_units_per_box <= 0 THEN
      RAISE EXCEPTION 'Informe a quantidade de unidades por caixa.';
    END IF;
  ELSE
    v_units_per_box := NULL;
  END IF;

  v_total := CASE
    WHEN v_packaging = 'box' THEN v_units_per_box * v_quantity
    ELSE v_quantity
  END;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.credit_establishment_products p
    SET
      name = v_name,
      description = NULLIF(trim(COALESCE(p_description, '')), ''),
      unit_price = v_price,
      active = COALESCE(p_active, true),
      image_url = v_image,
      packaging_type = v_packaging,
      units_per_box = v_units_per_box,
      quantity = v_quantity,
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
      active,
      image_url,
      packaging_type,
      units_per_box,
      quantity
    ) VALUES (
      p_establishment_id,
      p_company_id,
      v_name,
      NULLIF(trim(COALESCE(p_description, '')), ''),
      v_price,
      COALESCE(p_active, true),
      v_image,
      v_packaging,
      v_units_per_box,
      v_quantity
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', v_id,
    'total_units', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_credit_establishment_products(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_credit_establishment_product(
  UUID, UUID, TEXT, NUMERIC, TEXT, UUID, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;
