-- event_registrations guardava nome, CPF, telefone e e-mail com tres policies
-- abertas demais:
--   SELECT  USING (true)  -> qualquer usuario logado (inclusive comprador comum)
--                            lia a lista de inscritos de todos os eventos
--   UPDATE  USING (true)  -> qualquer usuario logado alterava ou confirmava a
--                            inscricao de terceiros
--   INSERT  para anon     -> qualquer visitante gravava inscricao em qualquer evento
--
-- Passa a valer o mesmo escopo do resto do sistema: Admin Master ou gestor da
-- empresa dona do evento. O INSERT publico sai de cena porque as duas RPCs de
-- inscricao sao SECURITY DEFINER e nao dependem de policy — e o fluxo de
-- inscricao gratuita foi descontinuado.

SELECT public.security_open_change_window('corrigir RLS de event_registrations', 5);

DROP POLICY IF EXISTS event_registrations_select_authenticated ON public.event_registrations;
DROP POLICY IF EXISTS event_registrations_update_authenticated ON public.event_registrations;
DROP POLICY IF EXISTS event_registrations_insert_public ON public.event_registrations;

CREATE POLICY event_registrations_select_admin_or_owner
  ON public.event_registrations
  FOR SELECT TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_registrations.event_id
        AND e.company_id IN (
          SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()
        )
    )
  );

CREATE POLICY event_registrations_update_admin_or_owner
  ON public.event_registrations
  FOR UPDATE TO authenticated
  USING (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_registrations.event_id
        AND e.company_id IN (
          SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()
        )
    )
  )
  WITH CHECK (
    public.user_is_admin_master_for_rls()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_registrations.event_id
        AND e.company_id IN (
          SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()
        )
    )
  );

-- Oraculo de CPF: respondia "esse CPF ja esta inscrito?" para qualquer visitante,
-- o que permite testar CPFs em massa. Nao ha uso publico legitimo com o fluxo
-- de inscricao gratuita descontinuado.
DO $$
DECLARE v_proc RECORD;
BEGIN
  FOR v_proc IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('event_registration_cpf_taken', 'register_free_event_with_wristband')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_proc.sig);
  END LOOP;
END;
$$;

SELECT public.security_close_change_window();
