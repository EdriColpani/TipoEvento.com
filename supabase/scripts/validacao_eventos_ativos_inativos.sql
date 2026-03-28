-- =============================================================================
-- Validação: eventos ATIVOS vs DESATIVADOS (coluna is_active)
-- Uso: SQL Editor do Supabase ou psql. Não altera dados.
-- =============================================================================

-- Resumo numérico
SELECT
  CASE
    WHEN is_active IS TRUE THEN 'Ativo (is_active = true)'
    WHEN is_active IS FALSE THEN 'Desativado (is_active = false)'
    ELSE 'Indefinido (NULL)'
  END AS categoria,
  COUNT(*) AS quantidade
FROM public.events
GROUP BY is_active
ORDER BY is_active DESC NULLS LAST;


-- Lista: eventos ATIVOS na plataforma
SELECT
  id,
  title,
  date,
  time,
  is_active,
  created_by,
  company_id
FROM public.events
WHERE is_active IS TRUE
ORDER BY date NULLS LAST, title;


-- Lista: eventos DESATIVADOS pelo organizador
SELECT
  id,
  title,
  date,
  time,
  is_active,
  created_by,
  company_id
FROM public.events
WHERE is_active IS FALSE
ORDER BY date NULLS LAST, title;


-- Visão única (útil para exportar / auditar)
SELECT
  id,
  title,
  date,
  time,
  is_active,
  CASE
    WHEN is_active IS TRUE THEN 'Ativo'
    WHEN is_active IS FALSE THEN 'Desativado'
    ELSE 'NULL'
  END AS status_is_active
FROM public.events
ORDER BY is_active DESC, date NULLS LAST, title;
