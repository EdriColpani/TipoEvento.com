# 401 na função `send-free-registration-email`

## Causa mais comum

**URL do Supabase e anon key de projetos diferentes.**

Ex.: no `.env` está `VITE_SUPABASE_URL=https://lzsjxepcsgwsnpsjzpcm.supabase.co` mas **não** está `VITE_SUPABASE_ANON_KEY` — aí o app usa a chave padrão de **outro** projeto. O gateway da Edge Function valida o JWT: projeto A + chave do projeto B = **401**.

## O que fazer (2 minutos)

1. Abra **Supabase Dashboard** → projeto **lzsjxepcsgwsnpsjzpcm** (ou o que aparece na sua URL).
2. **Settings** → **API**.
3. Copie:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** → `VITE_SUPABASE_ANON_KEY`
4. No `.env` (ou `.env.local`) na raiz do front:

```env
VITE_SUPABASE_URL=https://lzsjxepcsgwsnpsjzpcm.supabase.co
VITE_SUPABASE_ANON_KEY=cole_aqui_a_anon_public_inteira
```

5. **Reinicie** o `npm run dev` (Vite só lê `.env` ao subir).

## Deploy da função sem JWT (evita 401 mesmo sem login)

No terminal, na pasta do projeto:

```bash
cd C:\V3\tipoevento
supabase link --project-ref lzsjxepcsgwsnpsjzpcm
supabase functions deploy send-free-registration-email --no-verify-jwt
```

(`project-ref` = parte do host antes de `.supabase.co`.)

Ou no **Dashboard** → **Edge Functions** → **send-free-registration-email** → **Details** → desligar **Verify JWT** / **Enforce JWT**, se existir.

## Resend 403 (depois do 401 resolvido)

Até o domínio verificar: `FREE_EVENTS_FROM_EMAIL` = `onboarding@resend.dev` e na Resend cadastre o e-mail de destino como **test recipient**.
