# Checkpoint — Créditos cliente / Carteira EventFest Rede

**Atualizado:** 2026-05-19  
**Status:** ✅ **Fases 1–7 no código** — aplicar migration Fase 7 no SQL Editor (se ainda não aplicada)  
**Versão do plano:** 3.1  
**Branch de trabalho:** conferir `git branch` (ex. `evento`)

**Documentos:**

| Arquivo | Uso |
|---------|-----|
| [PLANO_CREDITOS_CLIENTE.md](./PLANO_CREDITOS_CLIENTE.md) | Técnico |
| [PLANO_CREDITOS_CLIENTE_JURIDICO.md](./PLANO_CREDITOS_CLIENTE_JURIDICO.md) | Jurídico/contábil |
| [PAYMENT_MP_PHASES.md](./PAYMENT_MP_PHASES.md) | MP / deploy funções |
| [CHECKLIST_HOMOLOGACAO_CREDITOS.md](./CHECKLIST_HOMOLOGACAO_CREDITOS.md) | Homologação E2E antes do go live |

---

## Onde paramos (resumo da sessão)

### Feito no repositório

- [x] Plano v3.1 (carteira universal, extrato, taxa MP, validação fee)
- [x] Migration `20260620120000_client_credit_wallet_v31.sql` (com bootstrap se schema incompleto)
- [x] Edge `create-credit-checkout` + handler `credit_topup:` no `mercadopago-webhook`
- [x] Front: `/wallet`, hook, checkout util
- [x] Rollback manual: `supabase/scripts/rollback_20260620120000_client_credit_wallet_v31.sql`
- [x] Fix deploy Edge: módulos locais `mp-token-resolver.ts` / `mp-credential-crypto.ts` na pasta da function

### Operacional (você)

- [ ] Migration aplicada no **projeto Supabase correto** (não no banco errado)
- [ ] Se rodou no banco errado → executar **rollback** lá primeiro
- [ ] `supabase functions deploy create-credit-checkout mercadopago-webhook`
- [ ] Teste recarga + extrato em `/wallet`

---

## Banco errado vs. banco certo

| Ação | Arquivo |
|------|---------|
| **Desfazer** no Supabase errado | `supabase/scripts/rollback_20260620120000_client_credit_wallet_v31.sql` |
| **Aplicar** no Supabase certo | `supabase/migrations/20260620120000_client_credit_wallet_v31.sql` ou `supabase db push` |

Confirme projeto no CLI: `supabase projects list` / Dashboard URL.

Após rollback no errado:

```sql
SELECT to_regclass('public.credit_topup_orders');  -- deve ser NULL
```

No **certo**, após migration:

```sql
SELECT to_regclass('public.credit_topup_orders');  -- deve existir

UPDATE public.system_billing_settings
SET consumption_module_enabled = true
WHERE id = 1;
```

---

## Checklist deploy (banco correto)

### Fases 1–6 já aplicadas — só Fase 7 (mobile / PWA carteira)

**Não use `supabase db push`**. SQL Editor:

`supabase/migrations/20260627120000_credit_phase7_mobile_wallet.sql`

Sem deploy obrigatório de Edge (redeploy `credit-spend` se quiser canal `app` no remoto).

---

### Fases 1–5 já aplicadas — Fase 6 + 6.1 (repasse MP imediato + estorno)

**Não use `supabase db push`**. SQL Editor — **nesta ordem**:

1. `supabase/migrations/20260625120000_credit_phase6_settlement_refund.sql` (se ainda não aplicada)
2. `supabase/migrations/20260626120000_credit_phase6_instant_mp_disbursement.sql`

Deploy Edge:

```powershell
supabase functions deploy credit-spend credit-spend-pdv manager-credit-payout
```

**Secrets:** `PLATFORM_MP_ACCESS_TOKEN` (pool EventFest). OAuth MP do gestor/parceiro receptor (`mp_collector_id`).

**Dev/teste sem MP real:** `CREDIT_MP_SIMULATE_DISBURSE=true` na Edge.

**Pré-requisito:** cada empresa receptora (evento, bar, pizzaria) com **Conectar Mercado Pago** em Perfil da Empresa.

---

### Fases 1–4 já aplicadas — só Fase 5 (relatórios admin)

**Não use `supabase db push`**. SQL Editor — arquivo:

`supabase/migrations/20260624120000_credit_phase5_admin_reports.sql`

Sem deploy de Edge Functions nesta fase.

---

### Fases 1–3 já aplicadas — só Fase 4 (PDV)

**Não use `supabase db push`** se o banco foi migrado no SQL Editor: o CLI lista *todas* as migrations locais que ainda não constam em `supabase_migrations.schema_migrations` no remoto.

Aplique **somente** este arquivo no **SQL Editor** do Supabase (projeto certo):

`supabase/migrations/20260623120000_credit_phase4_pdv.sql`

Depois, deploy das funções:

```powershell
cd C:\V3\tipoevento
supabase functions deploy issue-wallet-qr-token resolve-wallet-qr credit-spend-pdv credit-spend
```

**Secrets:** `ENTRY_QR_SIGNING_SECRET` (ou `WALLET_QR_SIGNING_SECRET`) para QR EFW; demais da Fase 1 (`PLATFORM_MP_ACCESS_TOKEN`, `SITE_URL`, etc.).

**Teste Fase 4:** cliente `/wallet` → “Mostrar QR no PDV” → gestor `/manager/credit/pdv` → identificar cliente → cobrar produto → extrato com uso.

---

### Primeira instalação (Fases 1–4 completas)

```powershell
cd C:\V3\tipoevento
supabase link
supabase db push
supabase functions deploy create-credit-checkout mercadopago-webhook credit-spend issue-wallet-qr-token resolve-wallet-qr credit-spend-pdv
```

---

## Fases — o que falta (retomar à noite)

### Fase 1 — fechar validação (se ainda não testou)

- [ ] Migration OK no banco certo
- [ ] Webhook credita saldo (`credit_topup_settle`)
- [ ] `fee_validation_ok` e `mp_fee_amount` no pedido pago
- [ ] Ajustar `credit_mp_fee_estimate_pct` / `credit_consumption_commission_pct` no admin se validação bloquear pacotes

### Fase 2 — UX carteira (refino)

- [x] Link “Carteira EventFest” no menu cliente + perfil
- [x] Polling após retorno MP (`?status=success&topup_id=`)
- [x] Tela “Onde usar” — RPC `list_credit_acceptance_network`
- [x] Exportar extrato CSV
- [x] Mensagens de erro amigáveis (módulo desligado, validação taxa via edge)

### Fase 3 — Pagar ingresso com crédito

- [x] RPC `credit_spend_ticket_purchase` (débito + splits + emite pulseiras)
- [x] Edge `credit-spend` (idempotency)
- [x] `EventDetails` / fluxo compra: opção “Pagar com crédito EventFest”
- [x] `credit_financial_splits` + descrição extrato de **uso**
- [x] RPC `list_manager_credit_spends` (dados para relatório gestor; UI dedicada na Fase 5)

### Fase 4 — PDV / consumo bar

- [x] CRUD `credit_establishments` (gestor) — RPCs + `/manager/credit/establishments`
- [x] Flag `events.credit_consumption_enabled` no formulário evento
- [x] Tela PDV + QR wallet EFW (TTL 90s) — `/manager/credit/pdv` + botão na carteira
- [x] `credit_spend_line_items` (produtos) via `credit_spend_consumption`

### Fase 5 — Admin Master

- [x] Relatório comissão consumo EventFest — `/admin/settings/credit-reports`
- [x] Passivo `platform_credit_liability` vs conciliação MP — aba Passivo
- [x] Auditoria forense (`credit_audit_log` + trigger ledger) — aba Auditoria
- [x] Mapa recarga origem × spend receptor — aba Cross-empresa
- [x] Relatório gestor consumos via crédito — `/manager/reports/credit-spends`

### Fase 6 — Payout gestor + clawback + repasse MP imediato

- [x] `manager_credit_settlement_ledger` + `credit_payout_batches` + `credit_refund_cases`
- [x] `credit_mp_disbursements` — transferência MP no instante do spend
- [x] Retenção D+N desativada (`credit_settlement_retention_days = 0`)
- [x] Edge `credit-spend` / `credit-spend-pdv` → MP Advanced Payments disbursement
- [x] Rollback automático se MP falhar (estorno saldo + ingresso)
- [x] Lançamentos `spend_commission_platform` + `spend_allocation_manager` no extrato
- [x] `manager-credit-payout` → reprocessar falhas MP
- [x] RPC `credit_refund_to_wallet` + clawback
- [x] UI gestor `/manager/credit/settlements` (histórico transferências)
- [x] Abas admin Repasses + Estornos em `/admin/settings/credit-reports`

### Fase 7 — App mobile

- [x] PWA: shortcuts Carteira / Ingressos + hint de instalação em `/wallet`
- [x] Mesmas APIs (recarga, spend, QR PDV) com `channel: app` no mobile
- [x] Biometria opcional (WebAuthn) para spend ≥ threshold (default R$ 200)
- [x] Migration `credit_spend_biometric_threshold` + `get_credit_wallet_status` estendido
- [x] Doc `docs/WALLET_INSTALAR_CELULAR.md`

---

## Arquivos principais (mapa rápido)

```
supabase/migrations/20260620120000_client_credit_wallet_v31.sql
supabase/migrations/20260621120000_credit_phase2_wallet_ux.sql
supabase/migrations/20260622120000_credit_phase3_spend_tickets.sql
supabase/scripts/rollback_20260620120000_client_credit_wallet_v31.sql
supabase/migrations/20260623120000_credit_phase4_pdv.sql
supabase/functions/create-credit-checkout/
supabase/functions/credit-spend/
supabase/functions/credit-spend-pdv/
supabase/functions/issue-wallet-qr-token/
supabase/functions/resolve-wallet-qr/
supabase/functions/mercadopago-webhook/index.ts  (credit_topup)
src/pages/ClientCreditWallet.tsx
src/pages/ManagerCreditEstablishments.tsx
src/pages/ManagerCreditPdv.tsx
src/pages/EventDetails.tsx
src/hooks/use-client-credit-wallet.tsx
src/hooks/use-event-details.tsx
src/utils/credit-topup-checkout.ts
supabase/migrations/20260624120000_credit_phase5_admin_reports.sql
supabase/migrations/20260625120000_credit_phase6_settlement_refund.sql
supabase/migrations/20260626120000_credit_phase6_instant_mp_disbursement.sql
supabase/functions/_shared/credit-mp-disbursement.ts
supabase/functions/_shared/mp-manager-credentials.ts
src/pages/AdminCreditReports.tsx
src/pages/ManagerCreditSpendsReport.tsx
src/pages/ManagerCreditSettlements.tsx
src/hooks/use-credit-reports.tsx
src/utils/credit-manager-payout.ts
```

---

## Decisões v3.1 (não reverter sem alinhamento)

- Carteira **única** por cliente (`user_id`)
- Saldo usável em **toda a rede** de parceiros habilitados
- Recarga: **crédito integral**; taxa MP não reduz saldo do cliente
- Comissão EventFest em **cada spend** no estabelecimento receptor
- Extrato com `public_description` obrigatório

---

## Retomar no Cursor (copiar à noite)

> Retomar créditos conforme `docs/CHECKPOINT_CREDITOS_CLIENTE.md`. Fase 1 já validada no banco certo: [sim/não]. Implementar **Fase 2** (ou 3 se preferir ingresso com crédito).

---

## Histórico checkpoint

| Data | Nota |
|------|------|
| 2026-05-19 | Arquitetura v3; pausa assessoria |
| 2026-05-20 | v3.1 + código Fase 1; rollback script; fix Edge `_shared`; migration bootstrap sem FK events |
| 2026-05-19 | **Fase 6.1** — repasse MP imediato no spend, rollback, extrato comissão/repasse |
| 2026-05-19 | **Fase 6** — settlement ledger, estornos/clawback, UI gestor e admin |
| 2026-05-19 | **Fase 5** — admin credit reports, audit log, conciliação passivo, relatório gestor |
| 2026-05-19 | **Fase 4** — estabelecimentos, PDV, QR carteira EFW, flag evento, `credit_spend_consumption` |
