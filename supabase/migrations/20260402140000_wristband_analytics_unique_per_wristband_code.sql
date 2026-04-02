-- Evita duas linhas com o mesmo código físico na mesma pulseira (duplo clique / retry no cadastro).
-- Remove duplicatas existentes: prioriza linha já atribuída a cliente; senão mantém a mais antiga.

DELETE FROM public.wristband_analytics wa
WHERE wa.id IN (
    SELECT id
    FROM (
        SELECT id,
            ROW_NUMBER() OVER (
                PARTITION BY wristband_id, code_wristbands
                ORDER BY
                    (client_user_id IS NOT NULL) DESC,
                    created_at ASC NULLS LAST,
                    id ASC
            ) AS rn
        FROM public.wristband_analytics
        WHERE code_wristbands IS NOT NULL AND btrim(code_wristbands) <> ''
    ) ranked
    WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS wristband_analytics_wristband_id_code_wristbands_uidx
    ON public.wristband_analytics (wristband_id, code_wristbands);

COMMENT ON INDEX public.wristband_analytics_wristband_id_code_wristbands_uidx IS
    'Um único analytics por código (BASE-NNN) dentro da mesma pulseira; impede duplicação por submit duplo.';
