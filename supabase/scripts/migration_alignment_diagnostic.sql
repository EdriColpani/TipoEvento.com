-- Rode no SQL Editor do Supabase para ver o que já existe no banco remoto.
-- Use o resultado para decidir até onde marcar migrations como "applied" (repair).

SELECT 'schema_migrations (últimas 15)' AS section;
SELECT version
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 15;

SELECT 'objetos_chave' AS section;
SELECT jsonb_pretty(
  jsonb_build_object(
    'event_turmas', to_regclass('public.event_turmas') IS NOT NULL,
    'company_billing_plan', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'billing_plan'
    ),
    'listing_monthly_charges', to_regclass('public.company_listing_monthly_charges') IS NOT NULL,
    'listing_active_until', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'listing_active_until'
    ),
    'credit_topup_orders', to_regclass('public.credit_topup_orders') IS NOT NULL,
    'credit_consumption_intents', to_regclass('public.credit_consumption_intents') IS NOT NULL,
    'contact_messages', to_regclass('public.contact_messages') IS NOT NULL,
    'consumption_license_charges', to_regclass('public.company_consumption_license_charges') IS NOT NULL,
    'hybrid_consumption_commission_pct', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'system_billing_settings'
        AND column_name = 'hybrid_consumption_commission_pct'
    )
  )
) AS remote_objects;

SELECT 'rpcs_chave' AS section;
SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'list_admin_contact_messages',
    'get_admin_credit_financial_position',
    'get_admin_platform_billing_revenue',
    'admin_generate_monthly_consumption_license_charges',
    'company_allows_credit_consumption'
  )
ORDER BY proname;
