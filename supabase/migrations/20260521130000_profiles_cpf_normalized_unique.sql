-- CPF em profiles: sempre só dígitos + unicidade por valor normalizado (evita 123.456.789-00 vs 12345678900)

UPDATE public.profiles
SET cpf = NULLIF(regexp_replace(COALESCE(cpf, ''), '\D', '', 'g'), '')
WHERE cpf IS NOT NULL;

-- Em duplicata real (mesmo CPF em contas diferentes), mantém o perfil mais antigo e limpa os demais
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY cpf
      ORDER BY id
    ) AS rn
  FROM public.profiles
  WHERE cpf IS NOT NULL AND length(cpf) = 11
)
UPDATE public.profiles p
SET cpf = NULL
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_cpf_key;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_cpf_digits_unique
  ON public.profiles (cpf)
  WHERE cpf IS NOT NULL AND length(cpf) = 11;

COMMENT ON INDEX public.profiles_cpf_digits_unique IS 'Um CPF (11 dígitos) por conta; valor sempre sem máscara';
