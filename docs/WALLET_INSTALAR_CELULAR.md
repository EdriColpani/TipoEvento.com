# Instalar a Carteira EventFest no celular (PWA)

A carteira usa as **mesmas APIs** do site (`/wallet`, recarga MP, pagamento com crédito, QR no PDV). No celular, instale como app para acesso rápido e biometria.

## Android (Chrome)

1. Abra **https://…/wallet** (logado).
2. Menu **⋮** → **Instalar app** ou **Adicionar à tela inicial**.
3. O atalho abre em tela cheia (`standalone`).

## iPhone (Safari)

1. Abra **/wallet** no **Safari**.
2. **Compartilhar** → **Adicionar à Tela de Início**.
3. Use o ícone EventFest na home.

## Atalhos no manifest

O `public/manifest.json` inclui shortcuts:

- **Carteira** → `/wallet`
- **Ingressos** → `/tickets`
- **Validador** → `/validator`

## Biometria (pagamentos altos)

- Limite padrão: **R$ 200** (`credit_spend_biometric_threshold` em `system_billing_settings`).
- Ative em **Carteira EventFest** → seção **Confirmação biométrica**.
- Compras com crédito acima do limite pedem Face ID / digital **neste aparelho**.
- Threshold `0` desliga a exigência (SQL Editor / admin futuro).

## Canal `app` nas APIs

Compras com crédito no celular ou PWA instalado enviam `channel: app` para `credit-spend` (extrato/auditoria).

## Deploy Fase 7

SQL Editor:

`supabase/migrations/20260627120000_credit_phase7_mobile_wallet.sql`

Sem deploy obrigatório de Edge (redeploy `credit-spend` se quiser canal `app` no remoto).
