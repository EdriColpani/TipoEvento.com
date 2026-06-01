# Handoff — Análise planos, bloqueio e onboarding

**Data:** 28/05/2026  
**Status:** análise concluída; implementações pendentes de decisão  
**Retomar:** bloqueio unificado pós-vencimento + melhorias de onboarding comercial

---

## 1. O que já foi implementado (sessão anterior)

### Fases A–C (consumo + licença)

- Migration `20260704120000_consumption_license_billing.sql`
- % consumo separados (híbrido vs consumo/licença)
- Licença R$ 99,99 (`consumption_or_license`), bloqueio de consumo até pagar
- Checkout MP + webhook (`create-consumption-license-checkout`, prefixo `consumption_license_charge:`)
- UI gestor: banner licença em `CompanyBillingPlanSection`
- UI admin: abas Preços e comissões (híbrido / consumo-licença)

### Fase D (implementada no código; aplicar migration + deploy edges)

- Migration `20260705120000_consumption_license_phase_d.sql`
  - `admin_create_consumption_license_charge`
  - `admin_set_consumption_license_charge_status`
  - `admin_generate_monthly_consumption_license_charges` (lote mensal)
  - `admin_set_company_billing_plan` → gera licença ao mudar para `consumption_or_license`
  - `get_admin_platform_billing_revenue`
  - `get_admin_credit_financial_position` estendido com `platform_billing`
- Admin faturas: `/admin/settings/monthly-invoices` com abas **Vitrine** | **Licença consumo**
- Gestor: `/manager/reports/consumption-license`
- Admin: override `consumption_license_fee` em `AdminCompanyBillingEditDialog`
- Relatórios: aba **Receita plataforma** em `AdminCreditReports`

### Deploy edges (PowerShell)

```powershell
cd c:\V3\tipoevento
supabase link --project-ref lzsjxepcsgwsnpsjzpcm
supabase functions deploy create-consumption-license-checkout mercadopago-webhook --project-ref lzsjxepcsgwsnpsjzpcm
supabase db push --project-ref lzsjxepcsgwsnpsjzpcm
```

---

## 2. Verificação — bloqueio quando vence / não renova

### Expectativa do negócio

> Ao vencer mês/dia sem renovar: bloquear funcionalidades do sistema e deixar **apenas** pagamento/renovação.

### Plano Divulgação (`listing_monthly`) — **parcial**

| Camada | Comportamento atual |
|--------|---------------------|
| Período | `listing_active_until` — 30 dias após pagamento |
| Detecção | `get_listing_subscription_phase` → `past_due` |
| Painel | `ManagerLayout` redireciona para `/manager/reports/listing-monthly` |
| Menu | Filtrado: só itens em `/manager/reports` |
| Backend | Desativa `validation_api_keys` |
| Edge | `validate-ticket`, `create-validation-key` bloqueados |

**Lacunas:**

1. **Não fica só pagamento** — com `past_due` ainda liberados:
   - **Todos** os relatórios (`/manager/reports/*`)
   - Perfil da empresa (`/manager/settings/company-profile`)
   - Ver `src/constants/listing-subscription.ts` → `isManagerPathAllowedWhenListingPastDue`
2. Sem trigger DB impedindo criar/editar eventos (bloqueio é UI + chaves).
3. Modelo = **30 dias corridos** desde o pagamento, não “dia 1 do mês calendário”.

### Plano Consumo / Licença (`consumption_or_license`) — **só consumo**

| Camada | Comportamento atual |
|--------|---------------------|
| Cobrança | Por mês calendário (`company_consumption_license_charges`) |
| Bloqueio | `company_allows_credit_consumption` exige licença do mês paga |
| Efeito | PDV, spend crédito, intents falham no backend |
| UI | Banner em Plano e cobrança + `/manager/reports/consumption-license` |

**Lacunas:**

1. **Não bloqueia o painel inteiro** — dashboard, eventos, relatórios, configurações seguem acessíveis.
2. Sem equivalente a `listing_active_until` para “acesso ao sistema”.
3. Sem gate no `ManagerLayout` como na divulgação.

### Decisão pendente (próxima sessão)

Alinhar os dois planos com a mesma regra:

1. Rotas permitidas vencido = **só** página de pagamento do plano (+ perfil mínimo / logout).
2. Gate no `ManagerLayout` para licença pendente (espelhar divulgação).
3. Reforço no banco (RPC/trigger `company_subscription_blocks_operations` por plano).
4. Opcional: `pg_cron` ou job no dia 1 para `admin_generate_monthly_consumption_license_charges`.

---

## 3. Verificação — cadastro novo de empresa e planos

### Fluxo atual (resumo)

1. `/manager/register` → termos → PF ou PJ  
2. **PJ:** `/manager/register/company` — só dados corporativos (**sem plano**)  
3. **PF:** modal → `ensureGestorCompanyLinked` (empresa sintética)  
4. Redirect → `/manager/dashboard`  
5. `ManagerLayout` / login → `/manager/settings/company-profile?tab=billing` se plano não confirmado  
6. Aba **Plano** → `CompanyBillingPlanSection` — 4 cards com label + descrição  
7. Modal contrato → aceite → RPC confirm/upgrade  
8. Se vitrine → cobrança + modal MP; se consumo/licença → licença + modal MP  

### Planos exibidos (ordem na UI)

| Código | Label |
|--------|--------|
| `listing_monthly` | Mensalidade — divulgação |
| `ticket_commission` | % sobre venda de ingressos |
| `ticket_plus_consumption` | % ingresso + consumo interno |
| `consumption_or_license` | Consumo / licença / mensal |

### O que **não** aparece na escolha de plano

- Valores R$ (99,99, mensalidade vitrine)
- Percentuais de comissão
- Tabela comparativa de funcionalidades
- Wizard “como você vai usar o sistema”

Uso do sistema = implícito na matriz `billing_plan_features` (menu/rotas após `isCompanyBillingReady`).

### Lacunas comerciais / UX

1. Plano **fora** do cadastro — gestor só vê depois no perfil.
2. Sem preços na tela de escolha.
3. Flash possível: cadastro PJ → `/manager/dashboard` → redirect para billing.
4. Empresas **novas:** `billing_plan = null`; empresas **migradas:** default `ticket_commission` + reaceite.

---

## 4. Decisões de negócio já fechadas (referência)

| Item | Decisão |
|------|---------|
| % consumo | Separado híbrido / consumo-licença |
| Licença no híbrido | **Não** (Opção A) — só `consumption_or_license` |
| Upgrade licença | Cobrança **integral** |
| Consumo sem licença paga | **Bloquear** (só módulo consumo hoje) |
| Licença padrão | R$ 99,99 |

Doc completo: `docs/PLANO_PRECOS_COMISSOES_CONSUMO_LICENCA.md`

---

## 5. Arquivos-chave

| Tema | Caminho |
|------|---------|
| Escolha de plano (gestor) | `src/components/CompanyBillingPlanSection.tsx` |
| Gate pós-cadastro | `src/components/layouts/ManagerLayout.tsx`, `src/constants/manager-billing-gate.ts` |
| Bloqueio vitrine vencida | `src/constants/listing-subscription.ts`, migration `20260604120000_listing_subscription_period.sql` |
| Bloqueio licença consumo | `supabase/migrations/20260704120000_consumption_license_billing.sql` |
| Cadastro PJ | `src/pages/ManagerCompanyRegister.tsx` |
| Cadastro PF | `src/components/ManagerIndividualRegisterDialog.tsx` |
| Definição dos 4 planos | `src/constants/billing-plans.ts` |
| Features por plano | `supabase/migrations/20260523120000_billing_plan_features.sql` |
| Fase D SQL | `supabase/migrations/20260705120000_consumption_license_phase_d.sql` |

---

## 6. Próximos passos sugeridos (amanhã)

1. **Decidir** se bloqueio vencido = só tela de pagamento (ambos os planos).
2. **Implementar** gate unificado (`ManagerLayout` + rotas permitidas + opcional RPC).
3. **Opcional onboarding:** preços na UI de planos e/ou escolha no cadastro.
4. **Opcional:** cron mensal automático para licenças.
5. **Homologação** cenários Fase E do plano comercial.

---

*Documento gerado para continuidade da conversa — análise de bloqueio pós-vencimento e fluxo de cadastro/planos.*
