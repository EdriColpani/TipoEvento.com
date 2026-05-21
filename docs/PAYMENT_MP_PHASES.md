# Pagamentos Mercado Pago — fases

## Implementado

| Fase | Descrição |
|------|-----------|
| **Credenciais separadas** | Ingressos (gestor) vs plataforma (EventFest/mensalidade). Secrets + criptografia no banco. |
| **UI gestor** | Perfil da Empresa → aba **Ingressos MP** (token manual + OAuth). |
| **UI admin** | Configurações Avançadas → credencial plataforma (mensalidade). |
| **Mensalidade** | `create-listing-monthly-checkout` + webhook `listing_charge:*` → `PLATFORM_MP_ACCESS_TOKEN`. |
| **Split no ato (ingressos)** | `marketplace_fee` na preferência + token do gestor no checkout. |
| **Webhook ingressos** | `financial_splits` + emissão de ingressos; consulta MP multi-token. |
| **Relatório** | `/manager/reports/financial` — colunas Split, comissão, líquido gestor, ID MP. |
| **OAuth gestor** | `mp-oauth-start`, `mp-oauth-callback` (PKCE), `mp-oauth-disconnect`, `collector_id` automático. |
| **Refresh token** | Renovação automática do access token OAuth antes do checkout (se expirado). |

## Pendente

| Fase | Descrição |
|------|-----------|
| **Assinatura recorrente** | Mensalidade vitrine via MP Preapproval / assinatura automática. |
| **Cobrança comissão consolidada** | Fatura mensal da comissão se split MP falhar (fallback). |
| **Painel admin comissões MP** | Extrato EventFest vs `financial_splits` reconciliado. |
| **Consumo / créditos** | Plano consumo completo (fase produto). |
| **OAuth PKCE obrigatório no painel MP** | Habilitar fluxo PKCE na aplicação MP (recomendado produção). |

## Secrets Supabase (Edge Functions)

| Secret | Uso |
|--------|-----|
| `PAYMENT_API_KEY_SECRET` | Fallback checkout ingressos (legado) |
| `PLATFORM_MP_ACCESS_TOKEN` | Mensalidade + marketplace integrator |
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | Criptografia tokens no banco |
| `MP_OAUTH_CLIENT_ID` | App ID marketplace EventFest |
| `MP_OAUTH_CLIENT_SECRET` | Secret OAuth |
| `MP_OAUTH_REDIRECT_URI` | Ex.: `https://PROJECT.supabase.co/functions/v1/mp-oauth-callback` |
| `SITE_URL` | Retorno após OAuth (front) |

## Migrations (ordem)

- `20260527120000_payment_credentials_split.sql`
- `20260528120000_payment_settings_security_isolation.sql`
- `20260529120000_mp_oauth_manager.sql`

## Deploy funções

```bash
supabase functions deploy create-payment-preference mercadopago-webhook create-listing-monthly-checkout
supabase functions deploy save-manager-payment-settings save-platform-mp-settings
supabase functions deploy mp-oauth-start mp-oauth-callback mp-oauth-disconnect
supabase functions deploy check-payment-status
```
