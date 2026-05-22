# Checkpoint — Pagamentos MP (continuar à noite)

**Atualizado:** 2026-05-19  
**Branch:** `evento` (working tree limpo no último save)  
**Referência completa:** [PAYMENT_MP_PHASES.md](./PAYMENT_MP_PHASES.md)

---

## Onde paramos

Código da **separação gestor/plataforma**, **split no checkout**, **OAuth PKCE** e **UI Ingressos MP** está no repositório. O que **ainda não foi validado em produção** nesta sessão:

1. Aplicar migration `20260529120000_mp_oauth_manager.sql` no Supabase remoto (se ainda não rodou `db push`).
2. Configurar secrets OAuth no projeto.
3. Configurar Redirect URL na app **marketplace** do Mercado Pago.
4. Deploy das Edge Functions OAuth + checkout.
5. Teste ponta a ponta: Conectar MP → compra → Relatório Financeiro (Split Registrado).

**Correção feita antes do checkpoint:** `save-manager-payment-settings` ao salvar token manual agora define `mp_connection_source: 'manual'` e limpa campos OAuth (`mp_oauth_connected_at`, `mp_refresh_token_ciphertext`).

---

## Checklist para retomar (ordem sugerida)

### 1. Banco (Supabase)

```powershell
cd C:\V3\tipoevento
supabase db push
```

Confirmar que existem (SQL Editor ou `\d payment_settings`):

- Colunas: `mp_collector_id`, `mp_refresh_token_ciphertext`, `mp_oauth_connected_at`, `mp_token_expires_at`, `mp_connection_source`
- Tabela: `mp_oauth_states`

Migrations na ordem (se alguma falhar, parar e corrigir):

| Arquivo | Status (marcar) |
|---------|-----------------|
| `20260527120000_payment_credentials_split.sql` | ☐ |
| `20260528120000_payment_settings_security_isolation.sql` | ☐ |
| `20260529120000_mp_oauth_manager.sql` | ☐ |

### 2. Secrets (Dashboard → Edge Functions → Secrets)

**Erro 500 em “Conectar com Mercado Pago”** quase sempre = faltam `MP_OAUTH_*` abaixo (verifique com `supabase secrets list --project-ref lzsjxepcsgwsnpsjzpcm`).

```powershell
supabase secrets set `
  MP_OAUTH_CLIENT_ID="SEU_APP_ID_MP" `
  MP_OAUTH_CLIENT_SECRET="SEU_CLIENT_SECRET_MP" `
  MP_OAUTH_REDIRECT_URI="https://lzsjxepcsgwsnpsjzpcm.supabase.co/functions/v1/mp-oauth-callback" `
  --project-ref lzsjxepcsgwsnpsjzpcm
```

| Secret | Obrigatório para OAuth |
|--------|------------------------|
| `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` | Sim (já deve existir) |
| `MP_OAUTH_CLIENT_ID` | Sim — **ausente hoje no projeto remoto** |
| `MP_OAUTH_CLIENT_SECRET` | Sim — **ausente hoje no projeto remoto** |
| `MP_OAUTH_REDIRECT_URI` | Sim — `https://lzsjxepcsgwsnpsjzpcm.supabase.co/functions/v1/mp-oauth-callback` |
| `SITE_URL` | Sim — URL do front (já configurado) |
| `PLATFORM_MP_ACCESS_TOKEN` | Mensalidade |
| `PAYMENT_API_KEY_SECRET` | Fallback ingressos (opcional se gestor sempre OAuth/manual) |

### 3. Mercado Pago Developers

- App tipo **marketplace** (integrador EventFest).
- **Redirect URL** = mesmo valor de `MP_OAUTH_REDIRECT_URI`.
- Habilitar **Authorization code + PKCE** (recomendado).
- Vínculo marketplace gestor ↔ integrador no painel MP (necessário para `marketplace_fee`).

### 4. Deploy funções

```powershell
cd C:\V3\tipoevento
supabase link --project-ref lzsjxepcsgwsnpsjzpcm

supabase functions deploy mp-oauth-start mp-oauth-callback mp-oauth-disconnect --project-ref lzsjxepcsgwsnpsjzpcm
supabase functions deploy create-payment-preference mercadopago-webhook check-payment-status --project-ref lzsjxepcsgwsnpsjzpcm
supabase functions deploy create-listing-monthly-checkout save-manager-payment-settings save-platform-mp-settings --project-ref lzsjxepcsgwsnpsjzpcm
```

`supabase/config.toml` deve ter `verify_jwt = false` para as funções MP (já configurado no repo).

### 5. Teste OAuth

1. Login como **gestor**.
2. **Perfil da Empresa** → aba **Ingressos MP** (`?tab=payments`).
3. **Conectar com Mercado Pago** → autorizar → voltar com sucesso + **Collector ID** visível.
4. Compra de ingresso de teste.
5. **Relatório Financeiro** (`/manager/reports/financial`) → filtro Pagas → Split **Registrado**, comissão, ID MP.
6. Conferir extratos nas duas contas MP.

**Alternativa sem OAuth:** token manual na mesma aba (avançado) — split funciona se marketplace estiver vinculado no painel MP.

### 6. Se der erro

- Anotar mensagem do MP na criação da preferência ou no redirect OAuth.
- Logs: Supabase → Edge Functions → `mp-oauth-callback`, `create-payment-preference`.
- Erros comuns: redirect URI diferente do cadastro MP; `SITE_URL` errado; PKCE desabilitado na app; gestor sem vínculo marketplace.

---

## Arquivos principais (para editar/debugar)

| Área | Caminho |
|------|---------|
| UI OAuth gestor | `src/components/ManagerTicketMpCredentialsSection.tsx` |
| API front | `src/utils/payment-settings-api.ts` |
| OAuth start | `supabase/functions/mp-oauth-start/index.ts` |
| OAuth callback | `supabase/functions/mp-oauth-callback/index.ts` |
| OAuth disconnect | `supabase/functions/mp-oauth-disconnect/index.ts` |
| Checkout ingressos | `supabase/functions/create-payment-preference/` |
| Webhook | `supabase/functions/mercadopago-webhook/` |
| Token manual gestor | `supabase/functions/save-manager-payment-settings/index.ts` |
| Migration OAuth | `supabase/migrations/20260529120000_mp_oauth_manager.sql` |

---

## Próximas fases (produto — ainda não implementadas)

Ver tabela em [PAYMENT_MP_PHASES.md](./PAYMENT_MP_PHASES.md):

- Assinatura recorrente mensalidade (MP Preapproval)
- Cobrança comissão consolidada (fallback)
- Painel admin reconciliação MP × `financial_splits`
- Módulo consumo/créditos completo

---

## Pergunta em aberto da sessão anterior

**Deploy:** rodar da máquina do dev ou testar primeiro com token manual e enviar erro do MP se a preferência falhar?  
→ Na retomada: escolher um caminho e marcar checklist acima.
