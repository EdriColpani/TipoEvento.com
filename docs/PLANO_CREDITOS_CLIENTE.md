# Plano técnico — Créditos do cliente (Carteira EventFest Rede)

**Versão:** 3.1  
**Status:** Fase 1 implementada — ver [CHECKPOINT_CREDITOS_CLIENTE.md](./CHECKPOINT_CREDITOS_CLIENTE.md) para retomar Fases 2+  
**Atualizado:** 2026-05-20  

**Documentos relacionados:**

| Documento | Uso |
|-----------|-----|
| [PLANO_CREDITOS_CLIENTE_JURIDICO.md](./PLANO_CREDITOS_CLIENTE_JURIDICO.md) | Validação jurídica, fiscal, contábil (v3.0) |
| [CHECKPOINT_CREDITOS_CLIENTE.md](./CHECKPOINT_CREDITOS_CLIENTE.md) | **Retomar à noite** — deploy, rollback, Fases 2–7 |
| [../supabase/scripts/rollback_20260620120000_client_credit_wallet_v31.sql](../supabase/scripts/rollback_20260620120000_client_credit_wallet_v31.sql) | Desfazer migration no banco errado |
| [PLANO_PLANOS_COBRANCA_EMPRESA.md](./PLANO_PLANOS_COBRANCA_EMPRESA.md) | Planos `ticket_plus_consumption`, `consumption_or_license` |
| [PAYMENT_MP_PHASES.md](./PAYMENT_MP_PHASES.md) | MP plataforma vs gestor (recarga usa plataforma) |

---

## 1. Decisões de produto (fechadas v3)

| ID | Regra |
|----|--------|
| D1 | **Carteira universal** — uma conta de crédito por `user_id` (cliente) |
| D2 | Saldo remanescente utilizável em **qualquer** evento/estabelecimento **da rede** habilitada |
| D3 | Recarga MP → conta **EventFest** (`PLATFORM_MP_ACCESS_TOKEN`) |
| D4 | Passivo agregado na **plataforma** — não escrow por empresa de origem |
| D5 | Comissão EventFest em **cada spend**, no % do **receptor** (empresa/estabelecimento onde consumiu) |
| D6 | Repasse ao gestor só sobre spends **na sua empresa**; payout periódico (não saca saldo não consumido) |
| D7 | Módulo ativo: plano consumo + flag admin + contrato + evento/estabelecimento receptor habilitado |
| D8 | Origem da recarga (`origin_company_id`, `origin_event_id`) = **metadado**; não restringe uso |
| D9 | **Crédito na EventFest** confirmado pelo jurídico — credor do saldo: plataforma |
| D10 | **Extrato obrigatório** com descrição clara em **toda** recarga e **todo** uso (requisito contábil) |
| D11 | Recarga: cliente paga e recebe **crédito integral** no pacote (ex. R$ 250 → saldo +250); taxa MP registrada à parte, **sem reduzir** o crédito do cliente |
| D12 | Taxa MP na recarga deve ser **≤ % comissão EventFest** sobre aquele valor (validação no checkout); contrato deve informar taxa MP e crédito líquido na conta EF |

**Revogado (v2):** carteira por empresa; bloqueio de uso cross-empresa.

---

## 2. Recarga R$ 250 — três valores (contábil x cliente)

| Conceito | Campo sugerido | Exemplo | Quem vê |
|----------|----------------|---------|---------|
| Valor pago pelo cliente | `gross_paid_amount` | R$ 250,00 | Cliente, extrato, contrato |
| Crédito na carteira | `credit_granted_amount` | R$ 250,00 (= gross, regra D11) | Cliente, saldo |
| Taxa Mercado Pago | `mp_fee_amount` | R$ 12,00 (var.) | Extrato (nota), admin, contábil |
| Entrada líquida caixa EventFest | `net_cash_received` | R$ 238,00 | Admin, conciliação MP |

**Regra de negócio (D12):** ao criar pacote / antes do checkout, validar:

```text
mp_fee_amount / gross_paid_amount  <=  consumption_commission_pct / 100
```

Se violar: **bloquear** pacote ou exibir erro ao admin (“taxa MP estimada supera comissão EventFest”). % comissão consumo vem de `commission_ranges` (tipo `consumption`) ou config global.

**Absorção da taxa:** EventFest absorve a diferença entre o que entra no MP e o passivo de R$ 250 — custo operacional até compensar pela comissão nos **usos**.

---

## 3. Extrato e descrições obrigatórias (contábil)

Todo lançamento em `credit_ledger_entries` exige `public_description` (texto fixo em PT-BR, sem ambiguidade).

### 3.1 Recarga (top-up)

**Cliente vê (exemplo):**

> **Recarga de crédito EventFest** — R$ 250,00 creditados na sua carteira.  
> Pagamento via Mercado Pago em [data/hora]. Referência: #TOP-2026-001234.  
> *A taxa de processamento do Mercado Pago é de responsabilidade da operação da plataforma e não reduz o valor creditado em sua carteira, conforme Termos de Uso.*

**Sistema registra (admin/contábil):**

| entry_type | amount | Descrição interna |
|------------|--------|-------------------|
| `topup_credit` | +250 | Crédito cliente — passivo plataforma |
| `topup_mp_fee` | (info) | Taxa MP R$ 12 — custo EF; `net_cash` R$ 238 |

Opcional: linha informativa no extrato do cliente (colapsável) com valor da taxa MP **apenas informativa**, sem alterar saldo.

### 3.2 Uso / “transferência” para empresa parceira (spend)

**Cliente vê:**

> **Uso de crédito** — [Razão social empresa Z] — Evento “[Nome]” — [Ingresso / Produto] — R$ 80,00.  
> Saldo após operação: R$ 170,00.

**Gestor receptor vê:**

> **Recebimento via crédito EventFest** — Cliente ***123 — R$ 73,60 líquido (após comissão plataforma R$ 6,40).  
> Evento “[Nome]” — Ref. spend #SP-…

**Admin / auditoria:** mesma transação com `credit_financial_splits`, `receiver_company_id`, correlation_id, IP, canal.

Cada spend gera **mínimo 1 linha** no extrato do cliente + registro em `credit_spend_orders` + split — “transferência para empresa” é **contábil/registro**, não PIX instantâneo ao gestor.

### 3.3 Campos no ledger

```text
credit_ledger_entries
  ...
  public_description TEXT NOT NULL     -- exibido ao cliente/gestor
  internal_description TEXT          -- admin master
  entry_subtype TEXT                 -- topup_credit | spend_debit | spend_allocation_manager | spend_commission_platform | refund | adjustment
  gross_paid_amount NUMERIC NULL     -- recarga
  mp_fee_amount NUMERIC NULL
  net_cash_received NUMERIC NULL
  credit_granted_amount NUMERIC NULL
```

---

## 4. Arquitetura em uma página

```
[Recarga] Cliente → MP → EventFest → credit_topup_settle
              → +ledger wallet
              → +platform_credit_liability

[Spend]   Cliente/PDV → credit-spend → valida RECEPTOR na rede
              → -ledger wallet
              → -platform_liability
              → credit_financial_splits (receiver_company_id)
              → manager_settlement_pending (por empresa receptora)

[Payout]  Cron/manager-credit-payout → MP gestor receptor (D+N, retenção)
```

**Não há** nova cobrança MP por spend (padrão). Dinheiro real entra na recarga; uso é contábil + payout em lote.

---

## 5. Modelo de dados (proposta implementação)

### 3.1 Tabelas

```text
client_credit_accounts
  user_id UUID PRIMARY KEY
  balance_cached NUMERIC(12,2)
  version INT
  status TEXT  -- active | frozen | closed
  currency TEXT DEFAULT 'BRL'

platform_credit_liability
  id SMALLINT PRIMARY KEY DEFAULT 1  -- singleton
  outstanding_amount NUMERIC(14,2)
  updated_at TIMESTAMPTZ

credit_ledger_entries
  id UUID PK
  account_user_id UUID
  entry_type TEXT  -- topup | spend | refund | adjustment | hold | release
  amount NUMERIC(12,2)  -- + entrada, - saída
  balance_after NUMERIC(12,2)
  idempotency_key TEXT UNIQUE
  correlation_id UUID
  origin_company_id UUID NULL
  origin_event_id UUID NULL
  receiver_company_id UUID NULL
  receiver_event_id UUID NULL
  receiver_establishment_id UUID NULL
  reference_type TEXT
  reference_id UUID
  public_description TEXT NOT NULL
  internal_description TEXT NULL
  entry_subtype TEXT
  metadata JSONB
  created_at TIMESTAMPTZ

credit_topup_orders
  id UUID PK
  client_user_id UUID
  origin_company_id UUID NULL
  origin_event_id UUID NULL
  gross_paid_amount NUMERIC(12,2)      -- valor cobrado MP (ex. 250)
  credit_granted_amount NUMERIC(12,2) -- creditado carteira (= gross)
  mp_fee_amount NUMERIC(12,2) NULL    -- preenchido no webhook (API MP)
  net_cash_received NUMERIC(12,2) NULL
  mp_fee_pct_snapshot NUMERIC(5,4) NULL
  consumption_commission_pct_snapshot NUMERIC(5,2) -- % EF vigente na recarga
  fee_validation_ok BOOLEAN            -- mp_fee <= comissão EF
  status TEXT  -- pending | paid | failed | refunded
  mp_preference_id TEXT
  mp_payment_id TEXT UNIQUE
  public_description TEXT              -- texto final gravado no extrato
  ...

credit_spend_orders
  id UUID PK
  client_user_id UUID
  receiver_company_id UUID NOT NULL
  receiver_event_id UUID NULL
  receiver_establishment_id UUID NULL
  gross_amount NUMERIC(12,2)
  channel TEXT  -- web | app | pos
  actor_user_id UUID
  ...

credit_spend_line_items
  spend_order_id UUID
  product_id UUID NULL
  product_name TEXT
  quantity INT
  unit_price NUMERIC(12,2)
  line_total NUMERIC(12,2)
  item_type TEXT  -- ticket | consumption

credit_financial_splits
  spend_order_id UUID
  receiver_company_id UUID
  gross_amount NUMERIC(12,2)
  platform_amount NUMERIC(12,2)
  manager_amount NUMERIC(12,2)
  applied_percentage NUMERIC(5,2)

credit_establishments
  id UUID PK
  company_id UUID
  event_id UUID NULL
  name TEXT
  credit_acceptance_enabled BOOLEAN
  active BOOLEAN

manager_credit_settlement_ledger
  company_id UUID
  spend_order_id UUID
  amount NUMERIC(12,2)
  status TEXT  -- pending | released | paid | clawback
  released_at TIMESTAMPTZ
  paid_at TIMESTAMPTZ
  mp_payout_id TEXT NULL

credit_refund_cases
  ...

credit_idempotency_keys
  key TEXT PK
  response JSONB
  expires_at TIMESTAMPTZ

credit_audit_log  -- somente admin master (RLS)
  ...
```

### 5.2 Removido vs. rascunho v2

- ~~`client_credit_accounts (user_id, company_id)`~~
- ~~`company_credit_escrow`~~

---

## 6. RPCs e Edge Functions

| Nome | Tipo | Responsabilidade |
|------|------|------------------|
| `ensure_client_credit_account` | RPC | Cria conta wallet se não existir |
| `credit_topup_settle` | RPC | Webhook; grava mp_fee, net_cash, descrições, valida fee vs comissão |
| `validate_credit_topup_package` | RPC | Admin/checkout: mp_fee estimada ≤ % comissão consumo |
| `get_client_credit_balance` | RPC | Saldo + opcional extrato resumido |
| `list_credit_ledger` | RPC | Extrato com `public_description` obrigatório; export CSV |
| `credit_spend` | RPC | Débito atômico + splits + side effect (ingresso/produto) |
| `credit_refund` | RPC | Admin; estorno parcial/total |
| `list_credit_acceptance_network` | RPC | Eventos/estabelecimentos onde pode gastar |
| `create-credit-checkout` | Edge | Pacotes recarga; MP plataforma |
| `mercadopago-webhook` | Edge | Estender handler `credit_topup:*` |
| `credit-spend` | Edge | Validação extra, rate limit, POS |
| `manager-credit-payout` | Edge | Liquidação MP gestor receptor |
| `reconcile-platform-liability` | Cron | `SUM(ledger)` vs liability vs MP |

**Regra:** cliente e PDV **nunca** fazem `UPDATE` em `balance_cached` direto.

---

## 7. Gates (validação)

### Recarga

- `consumption_module_enabled` OU `hybrid_consumption_module_enabled` (global)
- Empresa origem (se houver): plano consumo + contrato aceito

### Spend

- `receiver` empresa: plano consumo + contrato
- `receiver` evento: `credit_consumption_enabled = true`
- OU `receiver` establishment: `credit_acceptance_enabled = true`
- Listing/subscription da empresa receptora válida (reuso regras existentes)
- Conta cliente `active`; saldo ≥ gross

---

## 8. Integrações com módulos existentes

| Módulo | Integração |
|--------|------------|
| Ingressos | `credit_spend` purpose `ticket_purchase` → reserva/emite `wristband_analytics` |
| MP | Recarga = credencial plataforma; payout = OAuth gestor **receptor** |
| Planos | `company-billing-rules.ts` — `isHybridPlan`, `isConsumptionOrLicensePlan` |
| Relatórios | Nova aba admin + gestor (spends por empresa) |
| Validador/EF1 | Independente; wallet QR pode reutilizar padrão TTL |

---

## 9. Contrato e termos (jurídico + contábil)

Incluir nos **Termos — Carteira EventFest**:

1. Crédito permanece sob responsabilidade **EventFest**; válido na rede de parceiros.
2. Valor pago na recarga = valor creditado na carteira (ex. R$ 250).
3. Taxa do **Mercado Pago** não reduz o crédito do cliente; custo da operação de pagamento.
4. Na **utilização**, descrição no extrato identifica empresa/evento/produto.
5. Comissão EventFest sobre **cada uso**, conforme contrato do parceiro.
6. Estorno conforme política (saldo não utilizado).

---

## 10. UI (escopo previsto)

| Área | Telas |
|------|--------|
| Cliente | Carteira, recarga (resumo: “Você paga R$ 250 e recebe R$ 250 de crédito”), **extrato detalhado**, rede |
| Cliente checkout | Opção “Pagar com crédito EventFest” em ingressos |
| Gestor | Cardápio, PDV, relatório consumo crédito |
| Admin Master | Comissão consumo, passivo plataforma, auditoria forense, limites rede |

Copy sugerido: *“Crédito válido na rede de eventos e estabelecimentos parceiros EventFest.”*

---

## 11. Fases de implementação

| Fase | Entregável | Bloqueio |
|------|------------|----------|
| **0** | Termos + cláusulas MP/crédito (rascunho jurídico) | Parcial ✓ |
| 1 | Migrations + ledger com `public_description` + top-up (gross/mp_fee/net) + validação fee | **Em andamento** |
| 2 | UI carteira + **extrato legível** + rede aceitação | |
| 3 | Spend ingresso cross-empresa | |
| 4 | Estabelecimentos + PDV | |
| 5 | Relatórios admin + auditoria | |
| 6 | Payout gestor + clawback + reconciliação | |
| 7 | App mobile | |

**Código atual no repo:** nenhuma migration `credit_*` implementada ainda (apenas documentação).

---

## 12. Segurança (resumo)

- Ledger append-only; estorno = novo lançamento
- `idempotency_key` em top-up e spend
- `FOR UPDATE` na conta wallet no spend
- RLS: cliente vê só sua wallet; gestor vê spends da sua empresa; admin vê tudo
- Rate limit nas Edge Functions
- Wallet QR com TTL para PDV (fase 4)
- Limites configuráveis: recarga/dia, spend/transação (admin)

---

## 13. Histórico

| Versão | Data | Nota |
|--------|------|------|
| 3.1 | 2026-05-20 | Extrato obrigatório; recarga gross=credit; taxa MP; validação fee ≤ comissão; go Fase 1 |
| 3.0 | 2026-05-19 | Carteira universal + rede cross-empresa |
| 2.0 | 2026-05-19 | Carteira por empresa (substituída) |
| 1.0 | 2026-05-19 | Rascunho inicial |

---

*Checkpoint atualizado em [CHECKPOINT_CREDITOS_CLIENTE.md](./CHECKPOINT_CREDITOS_CLIENTE.md).*
