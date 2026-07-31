-- Fecha o acesso anonimo as funcoes mutantes do schema public.
--
-- Levantamento: 90 funcoes VOLATILE eram executaveis com a chave anon, que fica
-- exposta no bundle do front. Entre elas estavam coisas como
-- upsert_company_payout_profile (dados bancarios de repasse),
-- save_credit_establishment_product (preco de produto de qualquer empresa),
-- waive_ticket_chargeback_debt (perdoar divida) e release_ticket_checkout_reservation
-- (liberar reserva de terceiros). 44 tinham checagem interna de Admin Master e
-- 27 nao tinham guarda nenhuma.
--
-- Nao e caso de auditar uma a uma antes de agir: visitante deslogado nao tem uso
-- legitimo para nenhuma delas, exceto a vitrine publica. O checkout inteiro exige
-- login ("Faca login para entrar na fila"), entao authenticated basta.
--
-- Estrategia: conceder explicitamente a authenticated/service_role antes de
-- revogar, porque boa parte dessas funcoes so era acessivel pelo grant implicito
-- que o Postgres da a PUBLIC. Revogar sem o grant explicito derrubaria o app.
--
-- Verificado antes de aplicar: nenhuma policy avaliada por visitante deslogado
-- depende dessas funcoes, entao a vitrine publica nao quebra.

DO $$
DECLARE
  v_proc RECORD;
  v_publicas TEXT[] := ARRAY[
    -- Vitrine e paginas abertas, acessadas antes de qualquer login
    'get_event_ticket_availability',
    'get_event_turmas_availability',
    'create_public_contact_message',
    'create_public_landing_feedback',
    -- Links de cortesia chegam por e-mail e abrem sem sessao
    'get_complimentary_bundle_public',
    'get_complimentary_bundle_holder_view',
    'get_complimentary_seat_public'
  ];
BEGIN
  FOR v_proc IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.provolatile = 'v'
      AND pg_get_function_result(p.oid) <> 'trigger'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname <> ALL (v_publicas)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_proc.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_proc.sig);
  END LOOP;
END;
$$;

-- A linha de base de exposicao precisa refletir o novo estado, senao a sentinela
-- continuaria tratando o acesso anonimo dessas funcoes como aceitavel.
DELETE FROM public.security_exposure_baseline b
WHERE b.kind = 'function'
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) = b.identity
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  );
