# Checkpoint — Créditos cliente / Carteira EventFest Rede

**Atualizado:** 2026-05-27 (tarde)  
**Status:** ✅ **Fases 1–8 no código** — aplicar migrations **7–10** no SQL Editor se ainda não aplicadas  
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

## Onde paramos (resumo da sessão — 27/05 tarde)

### Feito hoje no repositório

- [x] **Upgrade plano consumo** — `ticket_plus_consumption` e `consumption_or_license` com `selectableByGestor: true` (`billing-plans.ts`)
- [x] Migration `20260630120000_billing_plan_upgrade_consumption.sql` — RPC `billing_plan_selectable_by_gestor()` inclui os 4 planos
- [x] **Carteira sempre visível** — migration `20260629120000_credit_wallet_client_visible.sql` (saldo/extrato/rede sem módulo; recarga só com módulo)
- [x] Fix tela branca `/wallet` — `topupPausedMessage` (era `moduleMessage` indefinido)
- [x] Fix header cortando título — `ClientLayout.tsx` padding-top no `main`
- [x] Doc operacional: roteiro pós-upgrade plano **% ingresso + consumo** (neste checkpoint)

### Sessão anterior (19/05) — já no código

- [x] **Fase 8** — relatórios contábeis + export CSV (gestor + admin)
- [x] `docs/CHECKLIST_HOMOLOGACAO_CREDITOS.md` — roteiro E2E
- [x] Fix acesso relatórios + admin Contábil rede completa
- [x] Patch `company_allows_credit_consumption` (comissão + módulo global)

### Já estava pronto (Fases 1–7)

- [x] Carteira, recarga MP, spend ingresso, PDV, repasse MP imediato, estornos, PWA, biometria
- [x] Admin: passivo, comissões, cross-empresa, auditoria, repasses, estornos

### Operacional (você — retomar à noite)

- [ ] Migrations no SQL Editor (ordem, se faltar): **7 → 8 → 9 → 10**
  - `20260627120000_credit_phase7_mobile_wallet.sql`
  - `20260628120000_credit_phase8_accounting_reports.sql`
  - `20260629120000_credit_wallet_client_visible.sql`
  - `20260630120000_billing_plan_upgrade_consumption.sql`
- [ ] **Ligar módulo global** (obrigatório para recarga + PDV):
  - **UI:** Admin Master → **Configurações Admin** → **Preços e comissões** (`/admin/settings/pricing`) → aba **Ingresso + consumo** → marcar *“Liberar módulo de consumo no plano híbrido (piloto)”* → **Salvar**
  - **Ou SQL:** `UPDATE system_billing_settings SET hybrid_consumption_module_enabled = true WHERE id = 1;`
  - ⚠️ **Não** está em “Planos das Empresas” nem “Planos e permissões”
- [ ] Gestor: plano **% ingresso + consumo** aceito; **MP conectado** (Perfil da Empresa → Ingressos MP)
- [ ] Evento pago: checkbox **“Aceitar pagamento com crédito EventFest”**
- [ ] Cadastrar estabelecimentos: `/manager/credit/establishments`
- [ ] Homologação E2E: `docs/CHECKLIST_HOMOLOGACAO_CREDITOS.md`
- [ ] Deploy Edge se ainda não fez Fase 6: `credit-spend`, `credit-spend-pdv`, `manager-credit-payout`

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
SET hybrid_consumption_module_enabled = true
WHERE id = 1;
-- (alternativa: consumption_module_enabled = true — qualquer uma liga credit_module_globally_enabled)
```

---

## Plano % ingresso + consumo — roteiro pós-upgrade

| Passo | O quê |
|-------|--------|
| 1 | Empresa com plano `ticket_plus_consumption` aceito (Configurações → Empresa → Plano) |
| 2 | Admin: módulo global ligado (ver acima — **Preços e comissões**) |
| 3 | Gestor: Mercado Pago OAuth em Perfil da Empresa |
| 4 | Evento: **Aceitar pagamento com crédito EventFest** |
| 5 | `/manager/credit/establishments` — bar/lojas ativos |
| 6 | Dia do evento: cliente `/wallet` (recarga + QR) → gestor `/manager/credit/pdv` |

**Fluxo:** recarga → ingresso com crédito → bar (PDV) → opcional pizzaria **outra empresa** (cross-parceiro).

**Não existe** cardápio digital para o cliente escolher produto sozinho — consumo é via **PDV operado pelo gestor**.

---

## Ligar módulo global (referência rápida)

| Onde **não** é | Onde **é** |
|----------------|------------|
| Planos das Empresas | **Preços e comissões** → `/admin/settings/pricing` |
| Planos e permissões | Aba **Ingresso + consumo** (híbrido) ou **Consumo / licença** |
| Relatórios de crédito | Checkbox + **Salvar** (Admin Master) |

Função no banco: `credit_module_globally_enabled()` = `consumption_module_enabled OR hybrid_consumption_module_enabled`.

---

## Checklist deploy (banco correto)

### Fases 1–6 já aplicadas — Fases 7–10 (mobile + contábil + carteira visível + upgrade plano)

**Não use `supabase db push`**. SQL Editor — **nesta ordem**:

1. `supabase/migrations/20260627120000_credit_phase7_mobile_wallet.sql`
2. `supabase/migrations/20260628120000_credit_phase8_accounting_reports.sql`
3. `supabase/migrations/20260629120000_credit_wallet_client_visible.sql`
4. `supabase/migrations/20260630120000_billing_plan_upgrade_consumption.sql`

Sem deploy obrigatório de Edge (redeploy `credit-spend` se quiser canal `app` no remoto).

**Rotas novas (front):**

| Quem | Onde |
|------|------|
| Gestor | `/manager/reports/credit-accounting` |
| Admin | `/admin/settings/credit-reports` → aba **Contábil** |

---

### Só Fase 7 (se 8 já aplicada)

`supabase/migrations/20260627120000_credit_phase7_mobile_wallet.sql`

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

## Fases — status

### Fase 8 — Relatórios contábeis (CSV)

- [x] RPC `list_manager_credit_accounting_report` (recargas origem + consumos receptor, por empresa)
- [x] RPC `list_admin_credit_accounting_report` (rede inteira + estornos; filtro empresa opcional)
- [x] UI gestor `/manager/reports/credit-accounting` + export CSV
- [x] UI admin aba **Contábil** + export CSV
- [x] Hook `useCreditReportsAccess` + `managerCanViewCreditReports`
- [ ] **Testar** após migration 8 no banco certo
- [ ] Pendente jurídico: NF, ISS, layout fiscal formal (ver `PLANO_CREDITOS_CLIENTE_JURIDICO.md`)

### Próximo passo sugerido à noite

1. Aplicar migrations **7–10** (SQL Editor) se faltarem
2. Ligar módulo em **Preços e comissões** → aba **Ingresso + consumo** (ou SQL acima)
3. Confirmar gestor: MP + estabelecimentos + evento com crédito
4. Rodar homologação: `CHECKLIST_HOMOLOGACAO_CREDITOS.md`
5. Ajustar `credit_mp_fee_estimate_pct` / comissão se `fee_validation_ok` falhar na recarga R$ 250

---

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

### Biometria (config)

| O quê | Onde |
|--------|------|
| Limite R$ (global) | `system_billing_settings.credit_spend_biometric_threshold` (default 200; `0` = desliga) |
| Cliente ativar Face ID | `/wallet` → Confirmação biométrica |
| Sem tela admin do threshold | só SQL por enquanto |

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
src/hooks/use-credit-reports-access.tsx
src/utils/credit-manager-payout.ts
supabase/migrations/20260627120000_credit_phase7_mobile_wallet.sql
supabase/migrations/20260628120000_credit_phase8_accounting_reports.sql
supabase/migrations/20260629120000_credit_wallet_client_visible.sql
supabase/migrations/20260630120000_billing_plan_upgrade_consumption.sql
src/constants/billing-plans.ts
src/components/layouts/ClientLayout.tsx
src/components/CreditAccountingReportPanel.tsx
src/pages/ManagerCreditAccountingReport.tsx
src/utils/export-credit-accounting-csv.ts
docs/CHECKLIST_HOMOLOGACAO_CREDITOS.md
docs/WALLET_INSTALAR_CELULAR.md
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

> Retomar créditos conforme `docs/CHECKPOINT_CREDITOS_CLIENTE.md`. Plano gestor: **% ingresso + consumo** (`ticket_plus_consumption`). Migrations 7–10 no banco certo: [sim/não]. Módulo global ligado em **Admin → Preços e comissões** → aba **Ingresso + consumo**: [sim/não]. Próximo: MP gestor + evento com crédito + estabelecimentos → homologação E2E (`docs/CHECKLIST_HOMOLOGACAO_CREDITOS.md`). `CREDIT_MP_SIMULATE_DISBURSE=true` em dev se MP real ainda não estiver.

---

## Histórico checkpoint

| Data | Nota |
|------|------|
| 2026-05-27 (tarde) | Upgrade plano consumo (gestor); carteira visível sem módulo; fix `/wallet` + layout; doc caminho admin **Preços e comissões** |
| 2026-05-19 (noite) | **Fase 8** contábil + CSV; checklist homologação; fix acesso gestor/admin relatórios |
| 2026-05-19 | Arquitetura v3; pausa assessoria |
| 2026-05-20 | v3.1 + código Fase 1; rollback script; fix Edge `_shared`; migration bootstrap sem FK events |
| 2026-05-19 | **Fase 6.1** — repasse MP imediato no spend, rollback, extrato comissão/repasse |
| 2026-05-19 | **Fase 6** — settlement ledger, estornos/clawback, UI gestor e admin |
| 2026-05-19 | **Fase 5** — admin credit reports, audit log, conciliação passivo, relatório gestor |
| 2026-05-19 | **Fase 4** — estabelecimentos, PDV, QR carteira EFW, flag evento, `credit_spend_consumption` |
