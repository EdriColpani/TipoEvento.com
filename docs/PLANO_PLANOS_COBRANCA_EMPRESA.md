# Plano: Planos de cobrança por empresa

**Status:** Fases 1–4 implementadas no código (aplicar migrations no Supabase)  
**Última atualização:** 2026-05-19  
**Contexto:** Nova fase do sistema — modelo comercial por empresa, contrato desacoplado de cada evento.

---

## Decisões de negócio (fechadas)

| # | Regra |
|---|--------|
| 1 | Mudança de plano pelo gestor **somente em upgrade** (automática no sistema, com cobrança correta). **Downgrade** só com **Admin Master**. Cliente não pode ficar alternando plano com frequência. |
| 2 | **Um plano por empresa** — sem planos paralelos no mesmo CNPJ/empresa. |
| 3 | Empresas já cadastradas: plano padrão **`ticket_commission`** (% sobre venda de ingressos, faixas em Admin → Faixas de comissão). |
| 4 | Consumo interno / créditos de cliente: **fase posterior** (planos podem aparecer no desenho, sem cobrança operacional ainda). |

### Contrato em todo cadastro de evento?

**Não como está hoje.** Aceite de termos de cobrança fica no **plano da empresa** + **versão do contrato**. No evento: apenas referência (`contract_id` / versão) para auditoria. Passo integral do contrato só se:

- empresa nunca aceitou a versão vigente do contrato do plano, ou  
- admin publicou nova versão (`requires_billing_reacceptance`).

---

## Modelos de plano (v1)

| Código | Nome na UI | Cobrança na v1 |
|--------|------------|----------------|
| `ticket_commission` | % sobre venda de ingressos | **Ativo** — `commission_ranges` + contrato `event_terms` |
| `listing_monthly` | Mensalidade — só divulgação do evento | Cadastro + contrato; fatura mensal manual ou integração depois |
| `ticket_plus_consumption` | % ingresso + controle de consumo | **Em breve** / bloqueado até fase consumo |
| `consumption_or_license` | % consumo (créditos) / licença / mensal | **Fase posterior** |

---

## Onde a empresa escolhe o plano

**Principal:** `Configurações → Perfil da Empresa` → seção **“Plano e cobrança”**.

**Fluxos:**

1. Primeiro acesso / sem plano: escolher plano + aceitar contrato → libera “Criar evento”.
2. Empresas existentes: migration define `ticket_commission` + tela única “Confirme seu plano atual” (aceite do contrato vigente).
3. Criar evento: **não** escolhe plano de novo; flags por evento (vitrine vs ingresso) ficam para v1.1 se necessário, derivadas do plano na v1.

**Admin Master:**

- **Preços e comissões** (`/admin/settings/pricing`): faixas de % por ingressos, mensalidade padrão vitrine, abas futuras híbrido/consumo.
- **Faturas mensais** (`/admin/settings/monthly-invoices`): lançar e quitar cobranças do plano vitrine.
- Textos legais: **Admin → Contratos** (`event_terms`, `company_membership`, tipos por plano).
- Downgrade e alteração forçada: **Planos das Empresas** (`/admin/settings/companies-billing`).

---

## Upgrade / downgrade

**Ordem sugerida dos planos** (ajustar na implementação se necessário):

```
listing_monthly (1) → ticket_commission (2) → ticket_plus_consumption (3) → consumption_or_license (4)
```

| Ação | Quem | Comportamento |
|------|------|----------------|
| **Upgrade** | Gestor (Perfil da Empresa) | RPC valida ordem + cooldown → aplica na hora → novo aceite de contrato se mudar tipo → cobrança segue plano novo |
| **Downgrade** | Só Admin Master | Gestor não altera; opcional “Solicitar alteração” |
| Troca que reduz nível | Downgrade | Sempre via admin |

**Anti-abuso:**

- Cooldown de upgrade: ex. **90 dias** (configurável).
- Histórico: `company_billing_plan_history`.
- Downgrade nunca automático.

---

## Fase 1 — Dados e backend

### Colunas em `companies`

- `billing_plan` — texto/enum
- `billing_plan_accepted_at` — timestamptz
- `billing_contract_id` — FK `event_contracts`
- `billing_plan_locked_until` — opcional (fim do cooldown)
- `requires_billing_reacceptance` — boolean

### Tabela `company_billing_plan_history`

- `company_id`, `from_plan`, `to_plan`, `changed_by`, `change_type` (`initial` | `upgrade` | `admin_downgrade`), `created_at`

### `contract_acceptances`

- Registrar aceite por `company_id` + `contract_type` ao confirmar plano.

### Migração empresas existentes

```sql
UPDATE companies SET billing_plan = 'ticket_commission' WHERE billing_plan IS NULL;
```

### RLS / RPC

- Gestor: `request_billing_plan_upgrade(new_plan)` — valida ordem + cooldown.
- Admin Master: alteração livre (downgrade incluso).

---

## Fase 2 — UI gestor

1. Seção **Plano e cobrança** em `ManagerCompanyProfile.tsx`.
2. Modal de aceite de contrato ao confirmar/alterar plano.
3. Bloqueio em criar evento se plano nulo ou `requires_billing_reacceptance`.
4. `EventFormSteps.tsx`: remover passo contrato quando empresa já aceitou versão vigente.

---

## Fase 3 — Admin Master

1. Lista empresas: coluna Plano + ação “Alterar plano”.
2. Contratos por tipo/plano.
3. Faixas de comissão só para empresas `ticket_commission` (e futuro híbrido).

---

## Fase 4 — Cobrança automática por plano

| Plano | v1 |
|-------|-----|
| `ticket_commission` | Checkout/webhook + faixas (existente) |
| `listing_monthly` | Evento vitrine; fatura mensal fora do fluxo de ingresso |
| Consumo / híbrido | Fase posterior |

---

## Cronograma sugerido

| Etapa | Entrega |
|-------|---------|
| **1A** | Migration + enum + default `ticket_commission` |
| **1B** | RPC upgrade + history + RLS |
| **2A** | UI Perfil da Empresa |
| **2B** | Ajuste contrato no fluxo de evento |
| **3** | Admin downgrade + histórico |
| **4** | Mensalidade vitrine + relatórios |
| **5** | Consumo / créditos (fase posterior) |

---

## Referências no código atual

- Contrato no evento: `src/components/EventFormSteps.tsx`, `MANAGER_EVENT_CREATION_CONTRACT_TYPE` em `src/constants/event-contracts.ts`
- Contratos admin: `src/pages/AdminEventContracts.tsx`
- Faixas comissão: `src/pages/AdminCommissionTiers.tsx`, tabela `commission_ranges`
- Perfil empresa: `src/pages/ManagerCompanyProfile.tsx`, rota `/manager/settings/company-profile`
- Aceites: `contract_acceptances`, `companies.contract_version_accepted_id`

---

## Fase 4 — Implementado

- Migration `20260519120000_listing_monthly_billing.sql`: `listing_only`, `listing_monthly_fee`, tabela `company_listing_monthly_charges`, RPCs admin
- Migration `20260519120100_block_listing_only_free_registration.sql`: bloqueio de inscrição gratuita em vitrine
- Eventos em plano `listing_monthly`: modo vitrine (`listing_only`), sem passo de preço/lotes no formulário
- Público: cards com badge **Divulgação**; detalhe do evento sem compra de ingressos
- Admin: **Mensalidade vitrine** (`/admin/settings/listing-monthly-billing`) — gerar cobrança e marcar pago
- Gestor: **Relatórios → Mensalidade de divulgação** (`/manager/reports/listing-monthly`)
- Campo **Mensalidade padrão** na edição de plano da empresa (admin)

## Próximo passo

1. Aplicar migrations: `supabase db push` (inclui `20260517120000`, `20260519120000`, `20260519120100`)
2. Gestor: **Perfil da Empresa → Plano e cobrança** → confirmar plano
3. Admin: **Preços e comissões**, **Faturas mensais** e **Planos das Empresas**
4. Migration `20260520120000_system_billing_settings.sql` (mensalidade padrão no banco)
5. Fase 5: consumo / créditos (fase posterior)
