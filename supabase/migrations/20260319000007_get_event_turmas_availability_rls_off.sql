-- Ajuste: garantir que a RPC de disponibilidade funcione para anon/public
-- mesmo quando há RLS em event_registrations.

CREATE OR REPLACE FUNCTION public.get_event_turmas_availability(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  nome text,
  capacity integer,
  used_count integer,
  remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,
    row_security = off
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.nome,
    t.capacity,
    COALESCE((
      SELECT count(*)
      FROM public.event_registrations er
      WHERE er.turma_id = t.id
    ), 0) AS used_count,
    GREATEST(
      t.capacity - COALESCE((
        SELECT count(*)
        FROM public.event_registrations er
        WHERE er.turma_id = t.id
      ), 0),
      0
    ) AS remaining
  FROM public.event_turmas t
  WHERE t.event_id = p_event_id
  ORDER BY t.created_at ASC, t.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_turmas_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_turmas_availability(uuid) TO anon, authenticated;

