-- CPF único por evento usando só dígitos (evita duplicata lógica e mensagem errada)
-- + RPC pública para checagem antes do insert (anon não tem SELECT na tabela)

-- 1) Remover duplicatas lógicas (mesmo CPF com máscaras diferentes), mantendo o registro mais antigo
DELETE FROM event_registrations a
USING event_registrations b
WHERE a.id > b.id
  AND a.event_id = b.event_id
  AND regexp_replace(COALESCE(a.cpf, ''), '\D', '', 'g') = regexp_replace(COALESCE(b.cpf, ''), '\D', '', 'g')
  AND length(regexp_replace(COALESCE(a.cpf, ''), '\D', '', 'g')) = 11;

-- 2) Normalizar CPF armazenado para 11 dígitos
UPDATE event_registrations
SET cpf = regexp_replace(COALESCE(cpf, ''), '\D', '', 'g')
WHERE cpf IS NOT NULL AND cpf ~ '\D';

-- 3) Índice único antigo era (event_id, cpf) com string exata; substituir por (event_id, cpf só dígitos)
DROP INDEX IF EXISTS idx_event_registrations_event_cpf;
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registrations_event_cpf_digits
  ON event_registrations (event_id, (regexp_replace(COALESCE(cpf, ''), '\D', '', 'g')));

-- Partial unique with WHERE might allow multiple NULL cpf - cpf is NOT NULL so ok

COMMENT ON INDEX idx_event_registrations_event_cpf_digits IS 'Uma inscrição por CPF (11 dígitos) por evento';

-- 4) RPC: já existe inscrição neste evento com este CPF? (SECURITY DEFINER para ver sem expor linhas)
CREATE OR REPLACE FUNCTION public.event_registration_cpf_taken(p_event_id uuid, p_cpf text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits text;
BEGIN
  digits := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  IF length(digits) <> 11 THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM event_registrations
    WHERE event_id = p_event_id
      AND regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = digits
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_cpf_taken(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_cpf_taken(uuid, text) TO anon, authenticated;
