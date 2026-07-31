-- Terceira leva do mesmo default privilege. Alem do financeiro, sobravam rotinas
-- internas (cron, jobs, helpers) executaveis por qualquer portador da chave anon.
-- Confirmado em producao: get_public_schema_ddl devolvia 693 KB com todas as
-- tabelas, corpos de funcao e — o pior — as proprias politicas de RLS, ou seja,
-- o mapa completo do sistema. Os jobs run_*/purge_* permitiam a um anonimo
-- disparar desativacao em massa de eventos/ingressos e limpar log de auditoria.

-- Grupo 1: sem nenhum uso no browser. Chamados por cron (executa como owner) ou
-- por Edge Function com service_role.
DO $$
DECLARE
  v_fn TEXT;
  v_proc RECORD;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'get_public_schema_ddl',
    'get_public_table_names',
    'run_past_events_lifecycle_deactivate',
    'run_ticket_inactivity_auto_deactivate',
    'run_ticket_inactivity_check',
    'purge_old_checkout_ops_events',
    'sync_event_batch_counter_assets',
    '_complimentary_expire_bundle_if_needed',
    '_complimentary_materialize_seat_ticket',
    '_complimentary_release_unredeemed_reserved',
    'try_clear_company_ticket_inactivity',
    'extend_listing_subscription_period',
    'refresh_listing_subscription_enforcement',
    'queue_ticket_inactivity_notification',
    'mark_ticket_inactivity_notification_sent',
    'mark_complimentary_bundle_email_sent',
    'apply_event_contract_amendment',
    'expire_stale_ticket_checkout_reservations',
    'attach_consumption_license_charge_mp_preference',
    'attach_listing_charge_mp_preference',
    'attach_ticket_inactivity_charge_mp_preference'
  ]
  LOOP
    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_proc.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc.sig);
    END LOOP;
  END LOOP;
END;
$$;

-- Grupo 2: o gestor logado chama do formulario de evento (EventFormSteps).
-- Perde anon, mantem authenticated.
DO $$
DECLARE
  v_fn TEXT;
  v_proc RECORD;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'backfill_event_counter_inventory',
    'cleanup_orphan_counter_wristbands'
  ]
  LOOP
    FOR v_proc IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_proc.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_proc.sig);
    END LOOP;
  END LOOP;
END;
$$;
