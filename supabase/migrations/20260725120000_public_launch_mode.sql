-- Modo pré-lançamento do site público (vitrine institucional vs site completo)

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS public_launch_mode TEXT NOT NULL DEFAULT 'preview'
    CHECK (public_launch_mode IN ('preview', 'live'));

COMMENT ON COLUMN public.system_billing_settings.public_launch_mode IS
  'preview = página institucional para visitantes anônimos; live = vitrine completa. Admin Master e Gestor PRO ignoram preview.';

CREATE OR REPLACE FUNCTION public.get_public_launch_mode()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.public_launch_mode FROM public.system_billing_settings s WHERE s.id = 1),
    'preview'::TEXT
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_launch_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_launch_mode() TO anon, authenticated;
