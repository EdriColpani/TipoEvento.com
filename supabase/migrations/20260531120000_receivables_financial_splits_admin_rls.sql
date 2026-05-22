-- Admin Master precisa ler receivables e financial_splits de todos os gestores
-- (relatório financeiro). Gestor/cliente mantêm policies existentes; esta policy é aditiva (OR).

ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receivables_select_admin_master" ON public.receivables;
CREATE POLICY "receivables_select_admin_master"
  ON public.receivables
  FOR SELECT
  TO authenticated
  USING (public.user_is_admin_master_for_rls());

DROP POLICY IF EXISTS "financial_splits_select_admin_master" ON public.financial_splits;
CREATE POLICY "financial_splits_select_admin_master"
  ON public.financial_splits
  FOR SELECT
  TO authenticated
  USING (public.user_is_admin_master_for_rls());
