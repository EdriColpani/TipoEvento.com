# Plano de ação — Preços e comissões (consumo + licença)

**Status:** decisões de negócio parcialmente fechadas — item 2 (licença no híbrido) em aberto  
**Data:** maio/2026  
**Contexto:** Admin → Preços e comissões (`/admin/settings/pricing`)

---

## Resumo executivo

| Aba / plano | UI admin | Rotina backend | Situação |
|-------------|----------|----------------|----------|
| Cobrança de ingressos | Faixas de % (`CommissionTiersPanel`) | `commission_ranges` + webhook MP (`applied_percentage`) | **OK** |
| Divulgação | Mensalidade padrão (`ListingMonthlyDefaultFeeSection`) | `listing_monthly_default_fee` + `company_listing_monthly_charges` | **OK** |
| Ingresso + consumo | Só notas + flag piloto | Comissão sobre consumo **já cobrada** via `%` global | **UI incompleta** |
| Consumo / licença | Só notas + flag piloto | Comissão sobre consumo **já cobrada**; **licença não existe** | **UI + cobrança licença faltando** |
| Upgrade de plano | Aceite de contrato | Atualiza plano; **não gera cobrança de licença** | **Gap crítico** |

---

## Verificação detalhada

### 1. Cobrança de ingressos (`ticket_commission` / híbrido)

- **Admin:** faixas em `CommissionTiersPanel` → tabela `commission_ranges`.
- **Runtime:** ao criar evento, `applied_percentage` é gravado no evento; no webhook MP (`mercadopago-webhook`) o split usa esse % → `financial_splits.platform_amount`.
- **Conclusão:** operacional.

### 2. Divulgação (`listing_monthly`)

- **Admin:** `system_billing_settings.listing_monthly_default_fee` (aba Divulgação).
- **Runtime:** `admin_create_listing_monthly_charge` / checkout MP; override por empresa em `companies.listing_monthly_fee`.
- **Conclusão:** operacional.

### 3. % sobre consumo (híbrido e consumo/licença)

#### O que já existe no banco (sem UI)

Migration `20260620120000_client_credit_wallet_v31.sql`:

```sql
system_billing_settings.credit_consumption_commission_pct  -- default 8.00
get_credit_consumption_commission_pct()
```

#### Onde a comissão é aplicada hoje

| Rotina | Arquivo / função | Comportamento |
|--------|------------------|---------------|
| Spend PDV | `credit_phase4_pdv` → `process_credit_pdv_spend` | `v_platform := gross * (pct/100)` → `credit_financial_splits` |
| Spend ingressos | `credit_phase3_spend_tickets` | Mesmo `get_credit_consumption_commission_pct()` |
| Recarga MP | `apply_credit_topup_payment` | Snapshot `consumption_commission_pct_snapshot` |
| Validação recarga | `validate_credit_topup_amount` | Usa o mesmo % |

**Conclusão:** a comissão da plataforma **sobre consumo de créditos já é lançada** (`platform_amount` em `credit_financial_splits` / relatórios admin fase 8).

#### Lacuna

- Aba **Ingresso + consumo** e **Consumo / licença** usam `FuturePlanSettingsSection`: apenas observações internas + checkbox de módulo piloto.
- **Não há campo** para editar `credit_consumption_commission_pct` (valor fixo 8% até alteração manual no banco).
- **Não há** percentual separado para híbrido vs consumo/licença (um único % global).

### 4. Licença / uso do sistema (`consumption_or_license`)

#### O que NÃO existe

- Coluna de **valor de licença** em `system_billing_settings`.
- Coluna de override por empresa (equivalente a `listing_monthly_fee`).
- Tabela de cobranças recorrentes (equivalente a `company_listing_monthly_charges`).
- RPC de geração de fatura / checkout MP para licença.
- Disparo automático no **upgrade** de plano.

#### Upgrade de plano hoje

`request_company_billing_plan_upgrade` e `admin_set_company_billing_plan`:

- Atualizam `companies.billing_plan`, contrato, histórico.
- **Não** criam cobrança financeira ao sair de `listing_monthly` → `consumption_or_license` (ou híbrido).

Documento `PLANO_PLANOS_COBRANCA_EMPRESA.md` prevê “cobrança segue plano novo”, mas **licença ainda não foi implementada** (fase posterior).

### 5. Elegibilidade de consumo por plano

`company_allows_credit_consumption(company_id)`:

- Planos `ticket_plus_consumption` e `consumption_or_license`: sempre (se módulo global ligado).
- Plano `ticket_commission`: só se admin ligar módulo global (`consumption_module_enabled` OR `hybrid_consumption_module_enabled`).

A comissão % **não valida** plano no momento do split — usa sempre o % global.

---

## Decisões de negócio (atualizado)

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | % consumo global ou separado? | **Separado** — híbrido e consumo/licença com campos distintos no admin |
| 2 | Licença no híbrido ou só consumo/licença? | **Opção A** — licença **somente** `consumption_or_license`; híbrido paga ingresso + % consumo, sem R$ 99,99/mês |
| 3 | Cobrança no upgrade | **Integral** (valor cheio no mês do upgrade) |
| 4 | Bloquear consumo sem licença paga? | **Sim** |
| 5 | Valor inicial da licença | **R$ 99,99** (`consumption_license_default_fee`) |

### Valores técnicos derivados (para implementação)

| Parâmetro | Valor / regra |
|-----------|----------------|
| `hybrid_consumption_commission_pct` | Configurável na aba **Ingresso + consumo** |
| `consumption_license_commission_pct` | Configurável na aba **Consumo / licença** |
| Fallback | Se coluna nullable vazia, usar `credit_consumption_commission_pct` legado (8%) |
| `consumption_license_default_fee` | **99,99** |
| Upgrade → licença | Cobrança **integral** imediata |
| `company_allows_credit_consumption` | Exige licença do mês **paga** quando plano exigir licença |

---

## Item 2 em aberto — O que é o plano híbrido?

No sistema, **híbrido** = código `ticket_plus_consumption`, label **“% ingresso + consumo interno”** (aba **Ingresso + consumo** no admin).

### Comparativo dos planos

| | **Híbrido** (`ticket_plus_consumption`) | **Consumo / licença** (`consumption_or_license`) |
|---|----------------------------------------|--------------------------------------------------|
| **Venda de ingressos** pela plataforma | **Sim** — comissão % por faixas (aba Cobrança de ingressos) | **Não** — eventos só vitrine (`listing_only`) |
| **Consumo com créditos EventFest** (PDV, cardápio, bar) | **Sim**, quando módulo liberado | **Sim**, quando módulo liberado |
| **Comissão sobre consumo** | % da aba híbrido (decisão #1) | % da aba consumo/licença (decisão #1) |
| **Foco do gestor** | Show/festival que **vende ingresso** e **vende no evento** com crédito | Casa/venue que **divulga** e **cobra consumo** sem ingresso pelo sistema |
| **Exemplo** | Festival com ingressos + fila do bar com carteira EventFest | Restaurante/clube com eventos gratuitos e consumo interno |

### Por que a dúvida da licença no híbrido?

No híbrido, a plataforma **já recebe**:

1. **% sobre cada ingresso** vendido (faixas de comissão).
2. **% sobre cada consumo** de crédito (campo separado do híbrido).

A **licença mensal (R$ 99,99)** seria uma **terceira** cobrança fixa de “uso do sistema / módulo de consumo”.

### Opções para fechar o item 2

**Opção A — Licença só em `consumption_or_license` (recomendação inicial)**

- Híbrido: paga comissão de ingresso + % consumo; **sem** mensalidade de licença.
- Consumo/licença: paga licença R$ 99,99/mês + % consumo; **sem** venda de ingressos.
- Motivo: evita “tripla cobrança” no híbrido; licença fica alinhada ao plano que **não** tem receita de ingressos.

**Opção B — Licença também no híbrido**

- Híbrido: comissão ingresso + % consumo **+ licença R$ 99,99/mês**.
- Consumo/licença: % consumo + licença R$ 99,99/mês.
- Motivo: licença = taxa fixa pelo **módulo de créditos/PDV**, independente de vender ingresso.

**Opção C — Licença no híbrido com valor diferente**

- Ex.: híbrido R$ 49,99/mês; consumo/licença R$ 99,99/mês.
- Exige segundo campo no admin (`hybrid_license_default_fee`).

> **Aguardando sua escolha:** A, B ou C (informar valores se C).

---

## Plano de ação recomendado (ajustado às decisões)

### Fase A + B — % consumo separados (unificado, ~4–5 dias)

**Objetivo:** Dois percentuais configuráveis no admin; rotinas de spend resolvem pelo plano da empresa **recebedora**.

1. Migration:
   - `hybrid_consumption_commission_pct NUMERIC(5,2)` (default ex.: 8,00)
   - `consumption_license_commission_pct NUMERIC(5,2)` (default ex.: 8,00)
   - Manter `credit_consumption_commission_pct` como fallback legado
2. Alterar `get_credit_consumption_commission_pct(p_receiver_company_id UUID)`:
   - `ticket_plus_consumption` → `hybrid_consumption_commission_pct`
   - `consumption_or_license` → `consumption_license_commission_pct`
   - Demais → fallback global
3. UI: campo % em cada aba (híbrido / consumo-licença) + flag piloto existente
4. Atualizar spend PDV, ingressos com crédito, snapshots em `credit_spend_orders`

---

### Fase C — Licença de uso do sistema (~1–1,5 semana)

**Objetivo:** Cobrar licença **R$ 99,99/mês** (integral no upgrade); bloquear consumo até pagamento.

**Escopo da licença:** depende da decisão do item 2 (planos elegíveis).

#### C1. Modelo de dados

```sql
-- system_billing_settings
consumption_license_default_fee NUMERIC(10,2) NOT NULL DEFAULT 99.99

-- companies (override)
consumption_license_fee NUMERIC(10,2)

-- companies — controle de bloqueio
consumption_license_active_until DATE  -- opcional: mês pago

-- nova tabela (espelho listing)
company_consumption_license_charges (
  id, company_id, reference_month, amount, status,
  mp_preference_id, mp_payment_id, paid_at, notes, ...
)
```

#### C2. RPCs

- `get_consumption_license_default_fee()` → 99,99
- `admin_create_consumption_license_charge(company_id, reference_month, amount?)`
- `ensure_consumption_license_charge_for_company(company_id)` — mês corrente, valor **integral**
- `company_consumption_license_is_paid(company_id)` — licença do mês paga
- Checkout MP (espelhar `create-listing-monthly-checkout`)

#### C3. Upgrade de plano

Estender `request_company_billing_plan_upgrade` / `admin_set_company_billing_plan`:

Quando `to_plan` exigir licença (conforme item 2):

1. Gerar cobrança **integral** do mês corrente (R$ 99,99 ou override empresa)
2. Retornar JSON com `charge_id` + orientação de pagamento
3. **Bloquear consumo** até `status = paid` (`company_allows_credit_consumption` passa a checar licença)

Cenário: **listing_monthly → consumption_or_license** → licença integral + consumo bloqueado até pagar.

#### C4. UI Admin

Aba **Consumo / licença**:

- **% sobre consumo** (`consumption_license_commission_pct`)
- **Valor padrão da licença mensal: R$ 99,99**
- Link para faturas de licença

Aba **Ingresso + consumo**:

- **% sobre consumo híbrido** (`hybrid_consumption_commission_pct`)
- Campo licença híbrido **somente se** decisão B ou C

#### C5. UI Gestor

- Banner pós-upgrade: “Licença gerada — R$ 99,99 — pagar para liberar consumo”
- Consumo/PDV/cardápio indisponível com mensagem clara enquanto pendente

---

### Fase D — Recorrência e relatórios (~3–5 dias)

1. Cron mensal (pg_cron ou job externo): gerar licenças pendentes para empresas em `consumption_or_license`
2. Relatório admin: receita licença vs comissão consumo vs comissão ingresso
3. Integrar em `AdminCreditReports` / posição financeira

---

### Fase E — Testes e homologação

| Cenário | Resultado esperado |
|---------|-------------------|
| Alterar % consumo no admin | Próximo spend usa novo % |
| Spend PDV R$ 100 @ 8% | `platform_amount = 8`, gestor = 92 |
| Upgrade listing → consumo/licença | Cobrança licença criada + MP checkout |
| Pagamento licença | Status `paid`, módulo liberado (se regra ativa) |
| Empresa híbrida | Ingresso usa faixas; consumo usa % consumo |

---

## Ordem de implementação sugerida

```
Fechar item 2 (licença no híbrido?)
    ↓
Fase A+B (% separados + UI)
    ↓
Fase C (licença R$ 99,99 + bloqueio + upgrade integral)
    ↓
Fase D (recorrência mensal + relatórios)
```

**MVP comercial:** Fase A+B + Fase C (após decisão item 2).

---

## Arquivos de referência no repositório

| Área | Caminho |
|------|---------|
| UI pricing | `src/pages/AdminPricingAndCommissions.tsx` |
| Abas futuras | `src/components/admin/FuturePlanSettingsSection.tsx` |
| Mensalidade (modelo UI) | `src/components/admin/ListingMonthlyDefaultFeeSection.tsx` |
| Settings hook | `src/hooks/use-system-billing-settings.tsx` |
| % consumo DB | `supabase/migrations/20260620120000_client_credit_wallet_v31.sql` |
| Spend + split | `supabase/migrations/20260623120000_credit_phase4_pdv.sql` |
| Upgrade plano | `supabase/migrations/20260517120000_company_billing_plans.sql` |
| Faturas vitrine | `supabase/migrations/20260519120000_listing_monthly_billing.sql` |
| Plano comercial doc | `docs/PLANO_PLANOS_COBRANCA_EMPRESA.md` |

---

## Decisões — checklist

- [x] % consumo separado híbrido / consumo-licença
- [x] Licença no híbrido? **Não (Opção A)** — só `consumption_or_license`
- [x] Upgrade: cobrança **integral**
- [x] Consumo bloqueado até licença paga
- [x] Licença padrão **R$ 99,99**

---

*Documento gerado a partir da auditoria do código e das rotinas Supabase/Resend/MP.*
