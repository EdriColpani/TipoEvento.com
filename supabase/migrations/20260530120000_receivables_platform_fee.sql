-- Comissão EventFest (marketplace) persistida do retorno MP — alinha relatório ao extrato da conta plataforma.

ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC(12, 2);

COMMENT ON COLUMN public.receivables.platform_fee_amount IS
  'Comissão marketplace/EventFest (application_fee / marketplace_fee do pagamento MP).';
