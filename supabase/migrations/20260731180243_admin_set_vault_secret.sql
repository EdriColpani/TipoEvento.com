-- Utilitario de provisionamento: grava/atualiza um segredo do Vault.
-- Os crons (drain da fila de webhook e notificacao de chargeback) leem
-- 'supabase_url' e 'service_role_key' de vault.decrypted_secrets. Sem uma
-- entrada por RPC a unica forma de cadastrar seria colar a service role key
-- em SQL ad-hoc, o que a deixa exposta em logs e historico de query.

CREATE OR REPLACE FUNCTION public.admin_set_vault_secret(
  p_name TEXT,
  p_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := NULLIF(trim(p_name), '');
  v_secret TEXT := NULLIF(p_secret, '');
  v_id UUID;
BEGIN
  IF v_name IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Nome e valor do segredo sao obrigatorios.';
  END IF;

  -- Apenas os segredos de infraestrutura conhecidos, para que a RPC nao vire
  -- um canal generico de escrita no Vault.
  IF v_name NOT IN ('supabase_url', 'service_role_key') THEN
    RAISE EXCEPTION 'Segredo "%" nao permitido por esta RPC.', v_name;
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name LIMIT 1;

  IF v_id IS NULL THEN
    v_id := vault.create_secret(v_secret, v_name);
    RETURN jsonb_build_object('ok', true, 'action', 'created', 'name', v_name);
  END IF;

  PERFORM vault.update_secret(v_id, v_secret, v_name);
  RETURN jsonb_build_object('ok', true, 'action', 'updated', 'name', v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_vault_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_vault_secret(TEXT, TEXT) TO service_role;
