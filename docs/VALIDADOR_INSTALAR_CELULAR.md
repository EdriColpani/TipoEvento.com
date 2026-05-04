# Instalar o validador no celular (PWA)

O site já tem **manifest** (`/manifest.json`) com `start_url: /validator` e ícones — vira “app” na tela inicial.

## Android (Chrome)

1. Abra **https://EventFest.com.br/validator** (ou seu domínio).
2. Toque no menu **⋮** → **Instalar app** / **Adicionar à tela inicial** (o texto varia).
3. Confirme. O ícone **Validador** abre em tela cheia (`standalone`).

**Requisitos:** HTTPS, primeira visita para o Chrome oferecer instalação; em alguns aparelhos só aparece depois de usar a página um pouco.

## iPhone (Safari)

1. Abra **https://.../validator** no **Safari** (não Chrome no iOS para “Add to Home Screen”).
2. Toque em **Compartilhar** → **Adicionar à Tela de Início**.
3. O ícone abre como atalho; comportamento é de web app em tela cheia se o manifest for respeitado.

## Se não aparecer “Instalar”

- Confirme **HTTPS**.
- Confirme que **Service Worker** está registrado (o projeto registra em produção).
- **Android:** menu do Chrome → “Instalar app”.
- **iOS:** só **Adicionar à Tela de Início** (Apple não usa o mesmo fluxo que Android).

## Coluna `confirmed` (inscrição gratuita)

Ao **validar entrada** com QR de inscrição gratuita (UUID), a Edge **`validate-ticket`** atualiza **`event_registrations.confirmed = true`** na linha cujo **`qr_code`** é esse UUID e **`event_id`** bate com o evento da chave.

Deploy: `supabase functions deploy validate-ticket`
