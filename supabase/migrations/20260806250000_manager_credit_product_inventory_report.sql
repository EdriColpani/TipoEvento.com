-- Relatório gestor: estoque atual x quantidade vendida por produto de crédito.
-- (corrige filtro: credit_spend_orders usa receiver_company_id / receiver_establishment_id)

CREATE OR REPLACE FUNCTION public.list_manager_credit_product_inventory_report(
  p_company_id UUID,
  p_establishment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_est_filter UUID := p_establishment_id;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa inválida.';
  END IF;

  IF NOT public.user_manages_credit_company(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  IF v_est_filter IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.credit_establishments ce
    WHERE ce.id = v_est_filter
      AND ce.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Estabelecimento inválido para esta empresa.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.establishment_name ASC, t.name ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id AS product_id,
      p.name,
      p.active,
      p.packaging_type,
      p.units_per_box,
      p.unit_price,
      p.establishment_id,
      ce.name AS establishment_name,
      COALESCE(p.quantity, 0) AS stock_quantity,
      CASE
        WHEN p.packaging_type = 'box'
          THEN COALESCE(p.units_per_box, 0) * COALESCE(p.quantity, 0)
        ELSE COALESCE(p.quantity, 0)
      END AS stock_total_units,
      COALESCE(s.sold_quantity, 0) AS sold_quantity,
      COALESCE(s.sold_revenue, 0) AS sold_revenue,
      COALESCE(s.sold_orders, 0) AS sold_orders
    FROM public.credit_establishment_products p
    JOIN public.credit_establishments ce
      ON ce.id = p.establishment_id
     AND ce.company_id = p.company_id
    LEFT JOIN (
      SELECT
        li.product_id,
        SUM(li.quantity)::integer AS sold_quantity,
        ROUND(SUM(li.line_total), 2) AS sold_revenue,
        COUNT(DISTINCT li.spend_order_id)::integer AS sold_orders
      FROM public.credit_spend_line_items li
      JOIN public.credit_spend_orders o ON o.id = li.spend_order_id
      WHERE o.receiver_company_id = p_company_id
        AND o.status = 'completed'
        AND li.product_id IS NOT NULL
        AND (
          v_est_filter IS NULL
          OR o.receiver_establishment_id = v_est_filter
        )
      GROUP BY li.product_id
    ) s ON s.product_id = p.id
    WHERE p.company_id = p_company_id
      AND (v_est_filter IS NULL OR p.establishment_id = v_est_filter)
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'establishment_id', v_est_filter,
    'items', COALESCE(v_rows, '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'products', COUNT(*)::integer,
        'stock_quantity', COALESCE(SUM((x->>'stock_quantity')::integer), 0),
        'sold_quantity', COALESCE(SUM((x->>'sold_quantity')::integer), 0),
        'sold_revenue', COALESCE(SUM((x->>'sold_revenue')::numeric), 0)
      )
      FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) x
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_manager_credit_product_inventory_report(UUID, UUID) TO authenticated;
