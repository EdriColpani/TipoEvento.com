# Fase D — Pendências pós go-live

Documento de referência para concluir o **PR-4** após o lançamento com clientes reais.  
A **D1 (hardening REST)** foi **antecipada parcialmente** — ver seção abaixo.

Relacionado: [PLANO_CORRECAO_GO_LIVE_ESTABILIDADE.md](./PLANO_CORRECAO_GO_LIVE_ESTABILIDADE.md) · [CHECKLIST_QA_GO_LIVE_30MIN.md](./CHECKLIST_QA_GO_LIVE_30MIN.md)

---

## D1 — Hardening REST (antecipada — o que já foi feito)

Infra reutilizada em todo o projeto:

| Utilitário | Arquivo | Uso |
|------------|---------|-----|
| RPC autenticado | `callRpcRest()` | `src/utils/supabase-rest-rpc.ts` |
| RPC público (anon) | `callRpcPublicRest()` | idem |
| Edge Functions | `invokeEdgeFunctionRest()` | `src/utils/edge-function-rest.ts` |
| Storage upload | `uploadStorageObjectRest()` | `src/utils/supabase-storage-rest.ts` |
| PATCH REST | `restPatch()` | `src/utils/supabase-rest.ts` |

### Migrados nesta antecipação (D1 parcial)

**Relatórios de crédito (17 RPCs)**

- `src/hooks/use-credit-reports.tsx` — 100% via `callRpcRest`

**Gestor — eventos e empresa**

- `src/hooks/use-event-edit-sales-guard.tsx`
- `src/hooks/use-event-go-live-checklist.tsx`
- `src/hooks/use-event-ticket-readiness.tsx`
- `src/hooks/use-company-event-categories.tsx`
- `src/hooks/use-company-plan-features.tsx` (sem fallback supabase-js)
- `src/utils/plan-feature-guard.ts`
- `src/utils/min-event-tickets-validation.ts`
- `src/utils/payment-settings-api.ts` (RPC + edge functions)
- `src/utils/company-members.ts` (invite, list, accept, delete parceiro)
- `src/pages/ManagerComplimentaryBundlesReport.tsx`
- `src/utils/credit-consumption-intent.ts` (RPC + edge)
- `src/utils/credit-manager-payout.ts` (RPC + edge)
- `src/utils/contract-acceptance-audit.ts`

**Admin**

- `src/hooks/use-admin-dashboard-stats.tsx` — RPC principal via REST (fallback `from()` mantido)
- `src/hooks/use-admin-companies-ticket-inventory-report.tsx`
- `src/hooks/use-admin-contact-inbox.tsx`
- `src/hooks/use-credit-reports-access.tsx`
- `src/hooks/use-checkout-observability.tsx` — RPC (lista de eventos ainda `from()`)
- `src/pages/AdminPlanFeatures.tsx` — sem fallback supabase-js
- `src/pages/AdminCreditReports.tsx` — job chargeback via `invokeEdgeFunctionRest`
- `src/components/AdminCompanyBillingEditDialog.tsx` — `admin_set_company_billing_plan`

**Admin — billing, inatividade e operação (go-live)**

- `src/components/admin/AdminConsumptionLicenseBillingPanel.tsx` — 3 RPCs licença consumo
- `src/components/admin/AdminTicketInactivityBillingPanel.tsx`
- `src/pages/AdminListingMonthlyBilling.tsx` — listing create/set status
- `src/hooks/use-system-billing-settings.tsx` — min ingressos (RPC); upsert settings ainda `from()`
- `src/hooks/use-company-ticket-inactivity.tsx` — 5 RPCs + 2 edge jobs via `invokeEdgeFunctionRest`
- `src/hooks/use-ticket-inactivity-charge-status.tsx`
- `src/components/admin/TicketInactivityAdminSection.tsx` — log auto-deactivate (RPC); salvar regras ainda `from()`
- `src/components/admin/AdminMasterBypassLogSection.tsx`
- `src/hooks/use-admin-contract-acceptances-report.tsx`
- `src/pages/AdminEventGeoBackfill.tsx`
- `src/pages/AdminContactMessages.tsx`

**Gestor — billing evento**

- `src/components/CompanyBillingPlanSection.tsx` — confirm/upgrade plano (sem fallback)
- `src/utils/plan-payment-checkout.ts` — ensure listing/consumption charge
- `src/hooks/use-consumption-license-status.tsx`
- `src/components/EventFormSteps.tsx` — cleanup/backfill counter wristbands

**Fases A–C (já concluídas antes desta antecipação)**

- Auth boot REST, cliente (EventDetails, inscrição, carteira), gestor (cortesias, PDV, avatar, crédito estabelecimentos/intents)

---

## D1 — Ainda pendente (migrar quando possível)

Busca: `supabase.rpc(` e `supabase.from(` no front.

### Admin — `from()` e upserts restantes

| Arquivo | Observação |
|---------|------------|
| `src/hooks/use-system-billing-settings.tsx` | `upsertBillingSettings` via `supabase.from` |
| `src/components/admin/TicketInactivityAdminSection.tsx` | salvar regras inatividade via `from().upsert` |
| `src/hooks/use-admin-dashboard-stats.tsx` | fallback `from()` métricas/atividade |
| `src/hooks/use-checkout-observability.tsx` | `from('events')` filtro alto tráfego |

### Gestor — evento e billing

| Arquivo | RPC / observação |
|---------|------------------|
| `src/utils/fetchBillingPlanContract.ts` | contrato por plano |
| `src/hooks/use-listing-subscription.ts` | fase assinatura vitrine |
| `src/pages/ManagerManageWristband.tsx` | `supabase.from()` + edge `revoke-entry-qr`, `update-wristband-status-mass` |
| `src/pages/ManagerCreditEstablishments.tsx` | `supabase.from('events')` lista eventos |

### Cliente / checkout / vitrine (prioridade baixa até D2)

| Arquivo | RPC / observação |
|---------|------------------|
| `src/hooks/use-client-credit-wallet.tsx` | saldo + ledger |
| `src/hooks/use-credit-wallet-phase2.tsx` | status, rede, topup order |
| `src/hooks/use-event-checkout-queue.tsx` | fila checkout |
| `src/hooks/use-event-details.tsx` | availability fallback RPC |
| `src/hooks/use-public-events.tsx` | vitrine + disponibilidade |
| `src/hooks/use-billing-plans-catalog.tsx` | comissões públicas |
| `src/pages/ComplimentaryBundlePage.tsx` | 3 RPCs públicos cortesia |
| `src/pages/ComplimentarySeatRedeemPage.tsx` | 2 RPCs resgate assento |
| `src/utils/public-launch-registration-block.ts` | `get_public_launch_mode` |

### Legado / infra

| Arquivo | Nota |
|---------|------|
| `src/utils/supabase-rpc.ts` | Wrapper antigo com timeout — migrar callers restantes e deprecar |

### Padrão de migração

```typescript
// Antes
const { data, error } = await supabase.rpc('nome_rpc', { p_arg: value });
if (error) throw error;

// Depois
import { callRpcRest } from '@/utils/supabase-rest-rpc';
const data = await callRpcRest<T>('nome_rpc', { p_arg: value }, 15_000);
```

Para RPC **público** (sem login): `callRpcPublicRest`.  
Para Edge Functions: `invokeEdgeFunctionRest('nome-func', body, { idempotencyKey?, timeoutMs? })`.  
Para `from()` simples: estender `restGet()` em `supabase-rest.ts` com query PostgREST (`tabela?select=...&limit=...`).

---

## D2 — Vitrine pública (decisão de produto: **após go-live**)

**Objetivo:** visitante acessa `/` e `/events/:id` sem login; demais rotas continuam protegidas.

### Arquivos principais

1. `src/components/ClientAuthGate.tsx` — liberar rotas públicas conforme flag
2. `src/utils/public-launch-access.ts` — regras de acesso visitante
3. `src/contexts/PublicLaunchModeContext.tsx` — modo vitrine vs login obrigatório
4. `src/utils/public-launch-registration-block.ts` — migrar para REST + integrar flag
5. `src/hooks/use-public-events.tsx` — migrar RPCs para `callRpcPublicRest`
6. Páginas: `Index.tsx`, `EventDetails.tsx` (parte visitante), SEO/meta

### Checklist D2

- [ ] Definir flag em banco (`public_launch_mode` ou settings existente)
- [ ] Admin: tela de toggle (já existe `AdminPublicLaunchSettings` — validar fluxo)
- [ ] `ClientAuthGate`: permitir `/`, `/events/:id`, assets estáticos
- [ ] Checkout/inscrição: continua exigindo login onde aplicável
- [ ] QA: visitante anônimo vê vitrine; gestor/cliente não perde sessão
- [ ] QA: reload anônimo na home não trava spinner

---

## D3 — Runbook migrations em todo release

### Procedimento mínimo por deploy

```bash
# 1. Conferir migrations locais vs remoto
supabase migration list --linked

# 2. Aplicar (staging/prod)
supabase db push --linked --yes

# 3. Confirmar
supabase migration list --linked
```

### Migrations críticas já citadas no go-live

- `20260730140000` — contrato/billing base
- `20260730150000` — e-mail gestor admin
- `20260730160000` — enforcement versão contrato evento

### Melhorias opcionais

- [ ] Step CI: `supabase db push --dry-run` ou diff antes de merge
- [ ] Checklist no PR template: “migrations incluídas?”
- [ ] Documentar rollback (revert migration manual — sem `down` automático)

---

## D4 — Monitoramento (opcional)

### Objetivo

Detectar deadlocks de auth e timeouts REST antes que o usuário reporte spinner infinito.

### Sugestões

1. **Sentry (ou similar)** no front:
   - `RpcTimeoutError` (`supabase-rpc.ts`)
   - AbortError em `callRpcRest` / `invokeEdgeFunctionRest`
   - `authPending` expirado sem `sessionReady` (evento custom)

2. **Logs estruturados** (console em prod via Vercel):
   - `[PublicLaunchMode] boot timeout`
   - `[callRpcRest] timeout fn=...`

3. **Métricas admin** — `use-admin-dashboard-stats` latência API já exposta no dashboard

4. **Alertas operacionais** — chargeback notify job (`run-credit-chargeback-notify-job`) falhas

---

## Ordem sugerida pós go-live

| Semana | Entrega |
|--------|---------|
| S+0 | Deploy D1 parcial + QA checklist §5 |
| S+1 | Concluir D1 admin billing/inatividade + EventFormSteps |
| S+2 | D2 vitrine pública + migrar `use-public-events` |
| S+3 | D1 cliente (carteira, fila checkout) + D3 runbook CI |
| Contínuo | D4 monitoramento |

---

## Critérios de aceite Fase D completa

- [ ] Nenhum `supabase.rpc` em telas gestor/admin críticas (billing, eventos, crédito, cortesias)
- [ ] Edge functions gestor/admin via `invokeEdgeFunctionRest` ou fetch equivalente
- [ ] Vitrine pública ativa conforme decisão de produto (D2)
- [ ] `supabase db push` documentado e executado em cada release (D3)
- [ ] Checklist QA 30 min verde após reload com sessão (§5)

---

*Última atualização: D1 billing/inatividade admin + gestor (planos, inatividade, licença consumo) migrados para REST.*
