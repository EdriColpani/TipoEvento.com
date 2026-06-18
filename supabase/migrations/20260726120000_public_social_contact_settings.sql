-- Redes sociais e telefone público (landing / pré-lançamento)

ALTER TABLE public.system_billing_settings
  ADD COLUMN IF NOT EXISTS public_instagram_handle TEXT NOT NULL DEFAULT 'eventfest.app',
  ADD COLUMN IF NOT EXISTS public_linkedin_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS public_contact_phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS public_contact_label TEXT NOT NULL DEFAULT 'EventFest';

COMMENT ON COLUMN public.system_billing_settings.public_instagram_handle IS
  'Usuário do Instagram exibido no site (sem @). Ex.: eventfest.app';
COMMENT ON COLUMN public.system_billing_settings.public_linkedin_url IS
  'URL completa do perfil ou página LinkedIn da EventFest.';
COMMENT ON COLUMN public.system_billing_settings.public_contact_phone IS
  'Telefone de contato público (landing). Se vazio, usa telefone da primeira empresa cadastrada.';
COMMENT ON COLUMN public.system_billing_settings.public_contact_label IS
  'Nome exibido ao lado do telefone no formulário de contato público.';

CREATE OR REPLACE FUNCTION public.get_public_contact_info()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'phone',
      COALESCE(
        NULLIF(trim(s.public_contact_phone), ''),
        (
          SELECT c.phone
          FROM public.companies c
          WHERE c.phone IS NOT NULL AND trim(c.phone) <> ''
          ORDER BY c.created_at ASC
          LIMIT 1
        )
      ),
    'company_name',
      COALESCE(
        NULLIF(trim(s.public_contact_label), ''),
        (
          SELECT COALESCE(c.trade_name, c.corporate_name, 'EventFest')
          FROM public.companies c
          WHERE c.phone IS NOT NULL AND trim(c.phone) <> ''
          ORDER BY c.created_at ASC
          LIMIT 1
        ),
        'EventFest'::TEXT
      ),
    'instagram_handle',
      COALESCE(NULLIF(trim(s.public_instagram_handle), ''), 'eventfest.app'),
    'linkedin_url',
      NULLIF(trim(s.public_linkedin_url), '')
  )
  FROM public.system_billing_settings s
  WHERE s.id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_contact_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_contact_info() TO anon, authenticated;
