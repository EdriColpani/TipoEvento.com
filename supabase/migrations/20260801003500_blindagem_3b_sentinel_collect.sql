-- BLINDAGEM CAMADA 3 (parte 2) — coleta do que precisa virar alerta.
--
-- A edge function so envia e-mail: toda a decisao do que alertar fica aqui,
-- em transacao. Sao duas RPCs de proposito — coletar e marcar como alertado
-- sao passos separados para que uma falha no envio nao apague o alerta.

CREATE OR REPLACE FUNCTION public.security_sentinel_collect()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report JSONB;
  v_item   JSONB;
  v_itens  JSONB;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Somente service_role.';
  END IF;

  v_report := public.security_drift_report();

  -- Cada achado vira uma linha de auditoria, mas so se o mesmo problema nao
  -- tiver sido reportado nos ultimos 7 dias: alerta repetido todo dia sobre a
  -- mesma pendencia treina o leitor a ignorar o alerta.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_report->'achados')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.security_ddl_audit a
      WHERE a.verdict = 'atencao'
        AND a.object_identity = (v_item->>'objeto')
        AND a.details = (v_item->>'tipo')
        AND a.occurred_at > timezone('utc', now()) - INTERVAL '7 days'
    ) THEN
      INSERT INTO public.security_ddl_audit (command_tag, object_kind, object_identity, verdict, details)
      VALUES ('SENTINELA', v_item->>'severidade', v_item->>'objeto', 'atencao', v_item->>'tipo');
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'quando', a.occurred_at,
           'usuario', a.db_user,
           'comando', a.command_tag,
           'objeto', coalesce(a.object_identity, '-'),
           'veredito', a.verdict,
           'detalhe', a.details
         ) ORDER BY a.id), '[]'::jsonb)
  INTO v_itens
  FROM public.security_ddl_audit a
  WHERE a.alerted_at IS NULL
    AND a.verdict IN ('bloqueado', 'auto_fechado', 'atencao', 'permitido');

  RETURN jsonb_build_object('total', jsonb_array_length(v_itens), 'itens', v_itens);
END;
$$;

REVOKE ALL ON FUNCTION public.security_sentinel_collect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_sentinel_collect() TO service_role;

CREATE OR REPLACE FUNCTION public.security_sentinel_mark_alerted(p_ids BIGINT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Somente service_role.';
  END IF;

  UPDATE public.security_ddl_audit
  SET alerted_at = timezone('utc', now())
  WHERE id = ANY(coalesce(p_ids, ARRAY[]::BIGINT[]))
    AND alerted_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'marcados', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.security_sentinel_mark_alerted(BIGINT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_sentinel_mark_alerted(BIGINT[]) TO service_role;
