-- =============================================================================
-- ROLLBACK MANUAL — NÃO rodar via `supabase db push`
-- Remove tudo criado por: 20260620120000_client_credit_wallet_v31.sql
-- Use apenas no banco onde a migration foi aplicada por engano.
-- =============================================================================

BEGIN;

-- 1) Tabelas (ordem por dependência)
DROP TABLE IF EXISTS public.credit_financial_splits CASCADE;
DROP TABLE IF EXISTS public.credit_spend_line_items CASCADE;
DROP TABLE IF EXISTS public.credit_spend_orders CASCADE;
DROP TABLE IF EXISTS public.credit_establishments CASCADE;
DROP TABLE IF EXISTS public.credit_ledger_entries CASCADE;
DROP TABLE IF EXISTS public.credit_topup_orders CASCADE;
DROP TABLE IF EXISTS public.client_credit_accounts CASCADE;
DROP TABLE IF EXISTS public.platform_credit_liability CASCADE;

-- 2) Coluna em events (se existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'credit_consumption_enabled'
  ) THEN
    ALTER TABLE public.events DROP COLUMN credit_consumption_enabled;
  END IF;
END $$;

-- 3) Colunas e constraints em system_billing_settings (só o que esta migration adicionou)
ALTER TABLE IF EXISTS public.system_billing_settings
  DROP CONSTRAINT IF EXISTS system_billing_settings_credit_commission_pct_check,
  DROP CONSTRAINT IF EXISTS system_billing_settings_credit_mp_fee_pct_check;

ALTER TABLE IF EXISTS public.system_billing_settings
  DROP COLUMN IF EXISTS credit_consumption_commission_pct,
  DROP COLUMN IF EXISTS credit_mp_fee_estimate_pct,
  DROP COLUMN IF EXISTS consumption_module_enabled,
  DROP COLUMN IF EXISTS hybrid_consumption_module_enabled;

-- 4) Se esta migration CRIOU system_billing_settings do zero (banco vazio),
--    descomente a linha abaixo SOMENTE se a tabela não existia antes:
-- DROP TABLE IF EXISTS public.system_billing_settings CASCADE;

-- 5) Funções RPC / helpers desta migration (qualquer assinatura)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS func_signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'credit_topup_settle',
        'attach_credit_topup_mp_preference',
        'create_credit_topup_order',
        'list_credit_ledger',
        'get_client_credit_balance',
        'ensure_client_credit_account',
        'validate_credit_topup_amount',
        'format_credit_topup_public_description',
        'get_credit_mp_fee_estimate_pct',
        'get_credit_consumption_commission_pct',
        'credit_module_globally_enabled'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.func_signature);
  END LOOP;
END $$;

-- NÃO remove user_is_admin_master_for_rls — usada por outras partes do sistema.

COMMIT;

-- Verificação rápida (deve retornar 0 linhas em cada):
-- SELECT to_regclass('public.credit_topup_orders');
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname LIKE 'credit_%';
