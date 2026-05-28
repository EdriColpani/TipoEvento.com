# Checklist go-live — Créditos + financeiro (EventFest + contador)

**Atualizado:** 2026-05-28  
**Objetivo:** validar que **tudo que movimenta dinheiro** grava trilha contábil e que o Admin Master consegue separar **passivo de cliente** vs **receita da plataforma** vs **custos MP**.

**Relacionado:** [CHECKLIST_HOMOLOGACAO_CREDITOS.md](./CHECKLIST_HOMOLOGACAO_CREDITOS.md) · [CHECKPOINT_CREDITOS_CLIENTE.md](./CHECKPOINT_CREDITOS_CLIENTE.md)

---

## 0. Antes de começar (uma vez)

### 0.1 Confirmar projeto Supabase

```sql
SELECT current_database();
SELECT to_regclass('public.credit_topup_orders') AS topup_ok,
       to_regclass('public.contact_messages') AS contact_ok,
       to_regclass('public.credit_consumption_intents') AS intents_ok,
       to_regclass('public.credit_establishment_products') AS catalog_ok;
```

| Objeto | Esperado |
|--------|----------|
| `topup_ok` | existe (não NULL) |
| `contact_ok` | existe (após migration 17) |
| `intents_ok` | existe (após migration 13–15) |
| `catalog_ok` | existe (após migration 12) |

### 0.2 Aplicar migrations (SQL Editor — **nesta ordem**)

Marque cada arquivo após executar com sucesso:

| # | Arquivo |
|---|---------|
| 1 | `20260620120000_client_credit_wallet_v31.sql` |
| 2 | `20260621120000_credit_phase2_wallet_ux.sql` |
| 3 | `20260622120000_credit_phase3_spend_tickets.sql` |
| 4 | `20260623120000_credit_phase4_pdv.sql` |
| 5 | `20260624120000_credit_phase5_admin_reports.sql` |
| 6 | `20260625120000_credit_phase6_settlement_refund.sql` |
| 7 | `20260626120000_credit_phase6_instant_mp_disbursement.sql` |
| 8 | `20260627120000_credit_phase7_mobile_wallet.sql` |
| 9 | `20260628120000_credit_phase8_accounting_reports.sql` |
| 10 | `20260629120000_credit_wallet_client_visible.sql` |
| 11 | `20260630120000_billing_plan_upgrade_consumption.sql` |
| 12 | `20260630130000_credit_phase9_establishment_catalog.sql` |
| 13 | `20260630140000_credit_phase10_client_intent_checkout.sql` |
| 14 | `20260630150000_credit_phase11_intent_ops_panel.sql` |
| 15 | `20260630160000_credit_phase12_intent_status_audit.sql` |
| 16 | `20260630170000_contact_messages.sql` |
| 17 | `20260630180000_admin_credit_financial_position.sql` |
| 18 | `20260630190000_admin_credit_mp_reconciliation_issues.sql` |

### 0.3 Módulo global + plano

**Admin Master → Preços e comissões → aba Ingresso + consumo** (ou SQL):

```sql
UPDATE public.system_billing_settings
SET hybrid_consumption_module_enabled = true
WHERE id = 1;

-- Conferir:
SELECT consumption_module_enabled, hybrid_consumption_module_enabled
FROM public.system_billing_settings WHERE id = 1;
```

Empresa de teste com plano híbrido ou consumo:

```sql
SELECT id, corporate_name, billing_plan, billing_plan_accepted_at IS NOT NULL AS plan_ok
FROM public.companies
WHERE billing_plan IN ('ticket_plus_consumption', 'consumption_or_license');
```

### 0.4 Edge Functions (deploy)

```powershell
cd C:\V3\tipoevento

supabase functions deploy create-credit-checkout mercadopago-webhook credit-spend credit-spend-pdv issue-wallet-qr-token resolve-wallet-qr manager-credit-payout issue-credit-menu-token resolve-credit-menu-token create-credit-consumption-intent confirm-credit-consumption-intent confirm-credit-consumption-intent-manager
```

### 0.5 Secrets / ambiente

| Variável | Uso |
|----------|-----|
| `PLATFORM_MP_ACCESS_TOKEN` | Pool MP EventFest (recarga + repasses) |
| `SITE_URL` | Retorno checkout / links |
| Webhook MP → `mercadopago-webhook` | Creditar recarga |
| `ENTRY_QR_SIGNING_SECRET` ou `WALLET_QR_SIGNING_SECRET` | QR carteira + QR balcão |
| `CREDIT_MENU_QR_SIGNING_SECRET` (opcional; fallback usa ENTRY/WALLET) | QR cardápio |
| `CREDIT_MP_SIMULATE_DISBURSE=true` | **Somente homologação** — simula repasse sem MP real |

Cada gestor receptor (evento, bar, pizzaria): **Mercado Pago conectado** em Perfil da Empresa.

---

## 1. Roteiro E2E financeiro (valores de exemplo)

Ajuste aos preços reais do seu ambiente.

| Etapa | Valor | Saldo cliente após |
|--------|--------|-------------------|
| Recarga | +R$ 250 | R$ 250 |
| Ingresso (Empresa A) | −R$ 80 | R$ 170 |
| Bar PDV (Empresa A) | −R$ 30 | R$ 140 |
| Pizzaria cross (Empresa C) | −R$ 50 | R$ 90 |

### 1.1 Recarga R$ 250

- [ ] Cliente: `/wallet` → recarga R$ 250 → MP → retorno success
- [ ] Saldo **R$ 250** (integral; taxa MP não reduz saldo)
- [ ] Admin → Créditos → **Passivo** sobe
- [ ] SQL abaixo: `fee_validation_ok = true`

### 1.2 Ingresso com crédito (Empresa A)

- [ ] Evento com **Aceitar pagamento com crédito EventFest**
- [ ] Saldo **R$ 170** (se ingresso R$ 80)
- [ ] Extrato cliente + relatório contábil admin

### 1.3 Bar — PDV operador (Empresa A)

- [ ] Cliente QR carteira → gestor PDV cobra R$ 30
- [ ] Saldo **R$ 140**

### 1.4 Pizzaria cross (Empresa C)

- [ ] Mesmo cliente, outra empresa, R$ 50
- [ ] Saldo final **R$ 90**
- [ ] Admin → aba **Cross-empresa** mostra origem A × receptor C

### 1.5 Cardápio + pedido cliente (opcional mas recomendado)

- [ ] PDV → **QR do balcão** → cliente monta carrinho em `/wallet/consumo?m=...`
- [ ] Pedido aparece no **Painel de atendimento** (status `new`)
- [ ] Gestor marca preparo → **Cobrar agora** (spend terminal)
- [ ] Histórico de status da intent preenchido

### 1.6 Contato landing

- [ ] Landing `/#contato` mostra telefone da empresa
- [ ] Formulário grava mensagem
- [ ] Admin → **Contato (landing)** lista a mensagem

---

## 2. SQL — conferência pós-E2E (contador + você)

Substitua `SEU_CLIENTE_UUID` pelo `user_id` do cliente de teste após o roteiro.

### 2.1 Passivo e carteira (núcleo fiscal)

```sql
-- Visão consolidada (Admin Master — mesma lógica da aba Passivo)
SELECT public.get_admin_credit_liability_reconciliation();
```

| Campo JSON | O que validar |
|------------|----------------|
| `liability_cached` | ≈ passivo em `platform_credit_liability` |
| `total_wallet_balances` | ≈ soma saldos ativos |
| `liability_matches_wallets` | `true` (ideal) |
| `topup_credit_granted` | soma recargas pagas no período |
| `spend_gross_total` | soma consumos |
| `platform_commission_total` | comissão EventFest nos spends |

```sql
SELECT outstanding_amount FROM public.platform_credit_liability WHERE id = 1;

SELECT COALESCE(SUM(balance_cached), 0) AS wallet_sum
FROM public.client_credit_accounts WHERE status = 'active';

SELECT user_id, balance_cached
FROM public.client_credit_accounts
WHERE user_id = 'SEU_CLIENTE_UUID';
```

**Esperado após roteiro:** `balance_cached` ≈ **90.00** (se usou os valores da tabela acima).

### 2.2 Ledger do cliente (auditoria linha a linha)

```sql
SELECT created_at, entry_type, entry_subtype, amount, balance_after, public_description
FROM public.credit_ledger_entries
WHERE account_user_id = 'SEU_CLIENTE_UUID'
ORDER BY created_at DESC
LIMIT 20;
```

**Esperado:** 1 linha de recarga (+250), linhas de spend (−80, −30, −50), `balance_after` coerente.

### 2.3 Recarga MP (taxa não pode “sumir”)

```sql
SELECT id, gross_paid_amount, credit_granted_amount, mp_fee_amount, net_cash_received,
       fee_validation_ok, status, mp_payment_id, paid_at
FROM public.credit_topup_orders
WHERE client_user_id = 'SEU_CLIENTE_UUID'
ORDER BY created_at DESC
LIMIT 5;
```

| Campo | Esperado |
|-------|----------|
| `credit_granted_amount` | 250.00 |
| `fee_validation_ok` | true |
| `mp_fee_amount` | preenchido (pode ser > 0) |
| `mp_payment_id` | preenchido após webhook |

### 2.4 Splits e comissão (receita EventFest vs gestor)

```sql
SELECT o.id AS spend_id, o.gross_amount, o.created_at,
       s.platform_amount, s.manager_amount, s.applied_percentage,
       rc.corporate_name AS receiver
FROM public.credit_spend_orders o
JOIN public.credit_financial_splits s ON s.spend_order_id = o.id
JOIN public.companies rc ON rc.id = o.receiver_company_id
WHERE o.client_user_id = 'SEU_CLIENTE_UUID'
  AND o.status = 'completed'
ORDER BY o.created_at DESC;
```

**Esperado:** `platform_amount + manager_amount` ≈ `gross_amount` (arredondamento de centavos pode variar 1 centavo).

### 2.5 Repasse MP (por spend)

```sql
SELECT d.spend_order_id, d.status, d.manager_amount, d.platform_amount,
       d.mp_transfer_id, d.error_message, d.created_at
FROM public.credit_mp_disbursements d
JOIN public.credit_spend_orders o ON o.id = d.spend_order_id
WHERE o.client_user_id = 'SEU_CLIENTE_UUID'
ORDER BY d.created_at DESC;
```

**Homologação com simulação:** `status = completed` e `mp_transfer_id` pode ser simulado.  
**Produção:** conferir no painel MP da conta EventFest.

### 2.6 Relatório contábil exportável (admin)

Na UI: Admin → Créditos → aba **Contábil** → export CSV.

Conferência SQL (resumo do período de hoje):

```sql
SELECT public.list_admin_credit_accounting_report(
  NULL,  -- empresa (NULL = rede inteira)
  CURRENT_DATE - 30,
  CURRENT_DATE,
  500,
  0
);
```

Verifique no JSON `summary`: `topup_credit_granted`, `spend_gross`, `platform_commission`, `refund_total`.

### 2.7 Posição financeira consolidada (gestão — o que pode investir)

```sql
SELECT public.get_admin_credit_financial_position(
  CURRENT_DATE - 30,
  CURRENT_DATE
);
```

| Bloco | Uso contábil |
|------|-------------|
| `client_credit.liability_now` | **Não é lucro** — passivo com clientes |
| `platform_revenue.platform_commission` | **Receita EventFest** (comissões) |
| `mp_costs.topup_mp_fees` | **Despesa/custo** MP sobre recargas |
| `managerial_position.available_operational_cash` | Indicador de caixa operacional (não substitui extrato MP oficial) |

**Regra prática:** só trate como “lucro investível” o que estiver em **comissão da plataforma**, descontadas taxas MP e repasses já devidos aos gestores — validado com contador.

### 2.8 Divergências MP (antes de produção)

```sql
SELECT public.list_admin_credit_mp_reconciliation_issues(
  CURRENT_DATE - 7,
  CURRENT_DATE,
  200,
  0
);
```

| `summary.total_issues` | Meta go-live |
|------------------------|--------------|
| `high_severity` | **0** (ou plano de correção documentado) |
| `topup_missing_mp_payment_id` | 0 em recargas pagas recentes |
| `spend_missing_mp_disbursement` | 0 em spends concluídos recentes |
| `mp_disbursement_failed` | 0 (ou reprocessar) |

---

## 3. Checklist UI (Admin Master)

| Tela | Rota / onde | OK? |
|------|-------------|-----|
| Passivo / conciliação | `/admin/settings/credit-reports` → Passivo | [ ] |
| Comissões por empresa | mesma tela → Comissões | [ ] |
| Cross-empresa | mesma tela → Cross-empresa | [ ] |
| Auditoria ledger | mesma tela → Auditoria | [ ] |
| Repasses MP | mesma tela → Repasses | [ ] |
| Estornos | mesma tela → Estornos | [ ] |
| **Contábil + CSV** | mesma tela → Contábil | [ ] |
| **Posição financeira** | mesma tela → Posição financeira | [ ] |
| **Conciliação MP** | mesma tela → Conciliação MP | [ ] |
| Mensagens contato | `/admin/settings/contact-messages` | [ ] |

---

## 4. O que NÃO é réplica 100% do extrato Mercado Pago (ainda)

Para fechar 100% “igual MP”, falta (fase futura):

- Importação/sincronização do **extrato oficial MP** (payments API) linha a linha
- Conciliação automática: `mp_payment_id` interno × payment MP × transfer MP
- DRE contábil fechado mensal exportável para contador (layout SPED/planilha padrão)

O que você já tem hoje cobre **governança interna forte**:

- Trilha imutável de ledger + audit log
- Splits plataforma/gestor por spend
- Passivo vs comissão separados
- Relatório contábil detalhado + posição gerencial + alertas de divergência

---

## 5. Go / no-go (assinatura)

| Papel | Nome | Data | Go-live créditos? |
|-------|------|------|-------------------|
| Técnico | | | [ ] Sim [ ] Não |
| Financeiro/contador | | | [ ] Sim [ ] Não |
| Produto | | | [ ] Sim [ ] Não |

**Observações finais:**

_________________________________________________________________

---

## 5. Rollback de emergência (só se necessário)

- Desligar módulo global (para novas recargas):

```sql
UPDATE public.system_billing_settings
SET consumption_module_enabled = false, hybrid_consumption_module_enabled = false
WHERE id = 1;
```

- Rollback completo do módulo v3.1 (script existente):  
  `supabase/scripts/rollback_20260620120000_client_credit_wallet_v31.sql`  
  **Somente no projeto Supabase errado / com autorização explícita.**
