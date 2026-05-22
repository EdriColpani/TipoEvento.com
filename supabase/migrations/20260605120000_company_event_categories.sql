-- Categorias de evento por empresa (cadastro do gestor)

CREATE TABLE IF NOT EXISTS public.company_event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT company_event_categories_name_unique UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_company_event_categories_company
  ON public.company_event_categories(company_id, sort_order, name);

COMMENT ON TABLE public.company_event_categories IS
  'Categorias de evento cadastradas por empresa; events.category armazena o nome.';

ALTER TABLE public.company_event_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_event_categories_select" ON public.company_event_categories;
CREATE POLICY "company_event_categories_select"
  ON public.company_event_categories
  FOR SELECT
  TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_event_categories.company_id
        AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "company_event_categories_insert" ON public.company_event_categories;
CREATE POLICY "company_event_categories_insert"
  ON public.company_event_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_event_categories.company_id
        AND uc.user_id = auth.uid()
    )
  );

-- Garante categorias padrão na primeira listagem
CREATE OR REPLACE FUNCTION public.ensure_default_company_event_categories(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names TEXT[] := ARRAY[
    'Música', 'Negócios', 'Arte', 'Gastronomia', 'Tecnologia', 'Esportes'
  ];
  v_name TEXT;
  v_ord INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_event_categories WHERE company_id = p_company_id
  ) THEN
    RETURN;
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    v_ord := v_ord + 1;
    INSERT INTO public.company_event_categories (company_id, name, sort_order)
    VALUES (p_company_id, v_name, v_ord)
    ON CONFLICT (company_id, name) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_company_event_categories(p_company_id UUID)
RETURNS SETOF public.company_event_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta empresa.';
  END IF;

  PERFORM public.ensure_default_company_event_categories(p_company_id);

  RETURN QUERY
  SELECT *
  FROM public.company_event_categories
  WHERE company_id = p_company_id
  ORDER BY sort_order ASC, name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_company_event_category(
  p_company_id UUID,
  p_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trim TEXT;
  v_row public.company_event_categories%ROWTYPE;
  v_max_ord INT;
BEGIN
  IF NOT public.user_can_manage_company_billing(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta empresa.';
  END IF;

  v_trim := trim(p_name);
  IF v_trim IS NULL OR length(v_trim) < 2 THEN
    RAISE EXCEPTION 'Informe um nome com pelo menos 2 caracteres.';
  END IF;

  IF length(v_trim) > 80 THEN
    RAISE EXCEPTION 'Nome da categoria muito longo (máx. 80 caracteres).';
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_ord
  FROM public.company_event_categories
  WHERE company_id = p_company_id;

  INSERT INTO public.company_event_categories (company_id, name, sort_order)
  VALUES (p_company_id, v_trim, v_max_ord + 1)
  ON CONFLICT (company_id, name) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.company_event_categories
    WHERE company_id = p_company_id AND name = v_trim;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_row.id,
    'name', v_row.name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_company_event_categories(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_company_event_categories(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_company_event_category(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_company_event_categories(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_event_category(UUID, TEXT) TO authenticated;
