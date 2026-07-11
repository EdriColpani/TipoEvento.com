-- Anti-fraude comissão/estoque:
-- 1) Congela applied_percentage na 1ª venda (não recalcula depois).
-- 2) Após 1ª venda, gestor só pode AUMENTAR quantity dos lotes (Admin pode reduzir).

CREATE OR REPLACE FUNCTION public.event_has_sales(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.wristband_analytics wa
      INNER JOIN public.wristbands w ON w.id = wa.wristband_id
      WHERE w.event_id = p_event_id
        AND (wa.client_user_id IS NOT NULL OR wa.status = 'used')
    )
    OR EXISTS (
      SELECT 1
      FROM public.receivables r
      WHERE r.event_id = p_event_id
        AND (
          COALESCE(r.status, '') = 'paid'
          OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = p_event_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.batch_inventory bi
      INNER JOIN public.event_batches eb ON eb.id = bi.batch_id
      WHERE eb.event_id = p_event_id
        AND COALESCE(bi.sold, 0) > 0
    );
$$;

COMMENT ON FUNCTION public.event_has_sales(UUID) IS
  'True quando o evento já teve venda, inscrição gratuita ou sold>0 no contador.';

CREATE OR REPLACE FUNCTION public.resolve_commission_percentage(p_ticket_qty INTEGER)
RETURNS TABLE(percentage NUMERIC, commission_range_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cr.percentage::NUMERIC, cr.id::BIGINT
  FROM public.commission_ranges cr
  WHERE COALESCE(cr.active, true) = true
    AND p_ticket_qty >= cr.min_tickets
    AND p_ticket_qty <= cr.max_tickets
  ORDER BY cr.min_tickets ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.event_ticket_qty_for_commission(p_event_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    COALESCE(
      (SELECT NULLIF(e.total_tickets, 0) FROM public.events e WHERE e.id = p_event_id),
      0
    ),
    COALESCE(
      (SELECT SUM(eb.quantity)::INTEGER FROM public.event_batches eb WHERE eb.event_id = p_event_id),
      0
    ),
    1
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_event_applied_percentage(p_event_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_paid BOOLEAN;
  v_current NUMERIC;
  v_qty INTEGER;
  v_pct NUMERIC;
  v_range_id BIGINT;
BEGIN
  SELECT COALESCE(e.is_paid, false), e.applied_percentage
  INTO v_is_paid, v_current
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT v_is_paid THEN
    RETURN v_current;
  END IF;

  -- Já congelado
  IF v_current IS NOT NULL THEN
    RETURN v_current;
  END IF;

  v_qty := public.event_ticket_qty_for_commission(p_event_id);
  SELECT r.percentage, r.commission_range_id
  INTO v_pct, v_range_id
  FROM public.resolve_commission_percentage(v_qty) r;

  IF v_pct IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.events e
  SET
    applied_percentage = v_pct,
    commission_range_id = COALESCE(v_range_id, e.commission_range_id)
  WHERE e.id = p_event_id;

  RETURN v_pct;
END;
$$;

COMMENT ON FUNCTION public.ensure_event_applied_percentage(UUID) IS
  'Define applied_percentage uma vez (estoque atual). Não sobrescreve se já existir.';

-- Congela % no UPDATE do evento após vendas; preenche se ainda null e sem vendas.
CREATE OR REPLACE FUNCTION public.enforce_event_applied_percentage_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty INTEGER;
  v_pct NUMERIC;
  v_range_id BIGINT;
  v_has_sales BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_paid, false)
       AND NEW.applied_percentage IS NULL
       AND COALESCE(NEW.listing_only, false) = false
    THEN
      v_qty := GREATEST(COALESCE(NEW.total_tickets, 0), COALESCE(NEW.capacity, 0), 1);
      SELECT r.percentage, r.commission_range_id INTO v_pct, v_range_id
      FROM public.resolve_commission_percentage(v_qty) r;
      IF v_pct IS NOT NULL THEN
        NEW.applied_percentage := v_pct;
        NEW.commission_range_id := COALESCE(v_range_id, NEW.commission_range_id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  v_has_sales := public.event_has_sales(OLD.id);

  IF v_has_sales THEN
    -- Após 1ª venda: % imutável (Admin também — evita fraude; suporte altera via SQL se precisar)
    NEW.applied_percentage := OLD.applied_percentage;
    NEW.commission_range_id := OLD.commission_range_id;

    -- Se ainda estava NULL (legado), congela agora
    IF NEW.applied_percentage IS NULL AND COALESCE(NEW.is_paid, false) THEN
      v_qty := public.event_ticket_qty_for_commission(OLD.id);
      SELECT r.percentage, r.commission_range_id INTO v_pct, v_range_id
      FROM public.resolve_commission_percentage(v_qty) r;
      IF v_pct IS NOT NULL THEN
        NEW.applied_percentage := v_pct;
        NEW.commission_range_id := COALESCE(v_range_id, OLD.commission_range_id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Sem vendas: pode recalcular se total mudou e front não enviou %
  IF COALESCE(NEW.is_paid, false)
     AND COALESCE(NEW.listing_only, false) = false
     AND (
       NEW.applied_percentage IS NULL
       OR NEW.total_tickets IS DISTINCT FROM OLD.total_tickets
     )
  THEN
    v_qty := GREATEST(COALESCE(NEW.total_tickets, 0), COALESCE(NEW.capacity, 0), 1);
    SELECT r.percentage, r.commission_range_id INTO v_pct, v_range_id
    FROM public.resolve_commission_percentage(v_qty) r;
    IF v_pct IS NOT NULL THEN
      NEW.applied_percentage := v_pct;
      NEW.commission_range_id := COALESCE(v_range_id, NEW.commission_range_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_applied_percentage_freeze ON public.events;
CREATE TRIGGER trg_enforce_event_applied_percentage_freeze
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_applied_percentage_freeze();

-- Na 1ª venda paga, garante % se ainda null.
CREATE OR REPLACE FUNCTION public.freeze_commission_on_receivable_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (
    COALESCE(NEW.status, '') = 'paid'
    OR COALESCE(NEW.payment_status, '') IN ('approved', 'authorized')
  ) THEN
    PERFORM public.ensure_event_applied_percentage(NEW.event_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_commission_on_receivable_paid ON public.receivables;
CREATE TRIGGER trg_freeze_commission_on_receivable_paid
  AFTER INSERT OR UPDATE OF status, payment_status ON public.receivables
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_commission_on_receivable_paid();

-- Estoque: após vendas, só aumentar quantity (gestor). Admin Master pode reduzir.
CREATE OR REPLACE FUNCTION public.enforce_stock_increase_only_after_sales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_has_sales BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR public.user_is_admin_master_for_rls() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_event_id := COALESCE(NEW.event_id, OLD.event_id);
  v_has_sales := public.event_has_sales(v_event_id);

  IF NOT v_has_sales THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'STOCK_INCREASE_ONLY: Após a primeira venda, não é permitido remover lotes. Só é permitido aumentar a quantidade.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.quantity < OLD.quantity THEN
    RAISE EXCEPTION
      'STOCK_INCREASE_ONLY: Após a primeira venda, a quantidade do lote só pode aumentar (atual: %, tentativa: %).',
      OLD.quantity, NEW.quantity;
  END IF;

  -- Não permitir mudar preço do lote após vendas
  IF TG_OP = 'UPDATE' AND NEW.price IS DISTINCT FROM OLD.price THEN
    RAISE EXCEPTION
      'STOCK_INCREASE_ONLY: Após a primeira venda, o preço do lote não pode ser alterado.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_stock_increase_only_after_sales ON public.event_batches;
CREATE TRIGGER trg_enforce_stock_increase_only_after_sales
  BEFORE UPDATE OR DELETE ON public.event_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_stock_increase_only_after_sales();

-- Espelho: não reduzir batch_inventory.total após vendas (gestor)
CREATE OR REPLACE FUNCTION public.enforce_batch_inventory_increase_only_after_sales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  IF auth.uid() IS NULL OR public.user_is_admin_master_for_rls() THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.total IS NULL OR OLD.total IS NULL OR NEW.total >= OLD.total THEN
    RETURN NEW;
  END IF;

  SELECT eb.event_id INTO v_event_id
  FROM public.event_batches eb
  WHERE eb.id = NEW.batch_id;

  IF v_event_id IS NOT NULL AND public.event_has_sales(v_event_id) THEN
    RAISE EXCEPTION
      'STOCK_INCREASE_ONLY: Após a primeira venda, o estoque total só pode aumentar.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_batch_inventory_increase_only_after_sales ON public.batch_inventory;
CREATE TRIGGER trg_enforce_batch_inventory_increase_only_after_sales
  BEFORE UPDATE OF total ON public.batch_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_batch_inventory_increase_only_after_sales();

-- Atualiza sales guard: inclui sold do contador + flag allow_quantity_increase
CREATE OR REPLACE FUNCTION public.get_event_edit_sales_guard(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_sold_count int;
  v_paid_receivables_count int;
  v_free_registrations_count int;
  v_batch_sold int;
  v_has_sales boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = v_user
        OR public.user_is_admin_master_for_rls()
        OR EXISTS (
          SELECT 1
          FROM public.user_companies uc
          WHERE uc.user_id = v_user
            AND uc.company_id = e.company_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int
  INTO v_sold_count
  FROM public.wristband_analytics wa
  INNER JOIN public.wristbands w ON w.id = wa.wristband_id
  WHERE w.event_id = p_event_id
    AND (
      wa.client_user_id IS NOT NULL
      OR wa.status = 'used'
    );

  SELECT COUNT(*)::int
  INTO v_paid_receivables_count
  FROM public.receivables r
  WHERE r.event_id = p_event_id
    AND (
      r.status = 'paid'
      OR COALESCE(r.payment_status, '') IN ('approved', 'authorized')
    );

  SELECT COUNT(*)::int
  INTO v_free_registrations_count
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id;

  SELECT COALESCE(SUM(bi.sold), 0)::int
  INTO v_batch_sold
  FROM public.batch_inventory bi
  INNER JOIN public.event_batches eb ON eb.id = bi.batch_id
  WHERE eb.event_id = p_event_id;

  v_has_sales := (
    v_sold_count > 0
    OR v_paid_receivables_count > 0
    OR v_free_registrations_count > 0
    OR v_batch_sold > 0
  );

  RETURN jsonb_build_object(
    'sold_count', GREATEST(v_sold_count, v_batch_sold),
    'paid_receivables_count', v_paid_receivables_count,
    'free_registrations_count', v_free_registrations_count,
    'batch_sold_count', v_batch_sold,
    'has_sales', v_has_sales,
    'allow_quantity_increase', v_has_sales,
    'min_capacity',
      GREATEST(
        v_sold_count,
        v_batch_sold,
        v_free_registrations_count,
        1
      )
  );
END;
$function$;

UPDATE public.events e
SET
  applied_percentage = sub.percentage,
  commission_range_id = COALESCE(sub.commission_range_id, e.commission_range_id)
FROM (
  SELECT e2.id AS event_id, r.percentage, r.commission_range_id
  FROM public.events e2
  CROSS JOIN LATERAL public.resolve_commission_percentage(
    GREATEST(COALESCE(e2.total_tickets, 0), COALESCE(e2.capacity, 0), 1)
  ) r
  WHERE COALESCE(e2.is_paid, false) = true
    AND COALESCE(e2.listing_only, false) = false
    AND e2.applied_percentage IS NULL
) sub
WHERE e.id = sub.event_id
  AND sub.percentage IS NOT NULL;

REVOKE ALL ON FUNCTION public.event_has_sales(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_commission_percentage(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_ticket_qty_for_commission(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_event_applied_percentage(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_has_sales(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_commission_percentage(INTEGER) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.event_ticket_qty_for_commission(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_event_applied_percentage(UUID) TO authenticated, service_role;
