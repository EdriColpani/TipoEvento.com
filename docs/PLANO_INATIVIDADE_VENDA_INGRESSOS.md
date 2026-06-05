# Plano: Inatividade de venda de ingressos (anti-fraude)

**Status:** Fases 1–3 implementadas (deploy + homologação pendente)  
**Última atualização:** 2026-06-02

---

## Duas regras distintas (não confundir)

| Regra | Objetivo | Status | Configuração Admin Master |
|-------|----------|--------|---------------------------|
| **A — Job dia 5** | Bloquear empresa (criar/reativar evento), e-mail, cobrança após 2 meses | **Implementado** | Ligar/desligar + taxa fixa |
| **B — Auto-desativar vitrine** | Desligar `is_active` após X dias da **data do evento**, zero vendas | **Não implementado** | Ligar/desligar + dias (0 = off) |

A regra **A** não desativa a vitrine sozinha. A regra **B** (fase 3) só desliga a vitrine; o bloqueio formal da empresa continua sendo responsabilidade do job do dia 5.

---

## Decisões fechadas

| # | Decisão |
|---|---------|
| 1 | Escopo do bloqueio **por empresa** (não por evento isolado) |
| 2 | Job dia 5: só eventos cuja **data caiu no mês de referência** (mês calendário anterior) |
| 3 | Planos afetados: **`ticket_commission`** e **`ticket_plus_consumption`** (ignora vitrine/consumo/licença) |
| 4 | Vendas contabilizadas: `receivables` pagos com `created_at` **no mês de referência** |
| 5 | Cobrança após **2 meses consecutivos** de inatividade; taxa global R$ 0 = sem cobrança |
| 6 | Pagamento da taxa **não** remove bloqueio — gestor desativa eventos pendentes ou Admin libera |
| 7 | Auto-desativar (fase 3): contagem a partir da **`events.date`** (data única; não há data fim) |
| 8 | Auto-desativar: **não** penaliza evento futuro nem fase de divulgação antes da data |
| 9 | Auto-desativar: **só** `is_active = false`; **não** dispara bloqueio de inatividade por si só |
| 10 | Dias sugeridos para auto-desativar: **30** (Admin pode alterar; ex.: 60). **0 = regra desligada** |

---

## Regra A — Job todo dia 5 (implementado)

**Onde configurar:** Preços e comissões → Cobrança de ingressos → **Inatividade de venda de ingressos**

| Campo | Chave | Efeito |
|-------|-------|--------|
| Ativar verificação mensal automática | `ticket_inactivity_enabled` | Desmarcado → job retorna `skipped: disabled` |
| Taxa fixa global | `ticket_inactivity_fee_default` | R$ 0 = sem cobrança automática após 2 meses |

**Não há** campo de “quantos dias” para esta regra — o dia **5** e o **mês calendário anterior** são fixos.

### Fluxo (exemplo: job em 05/05)

1. Analisa **abril** (`reference_month`).
2. Empresas em plano com comissão sobre ingressos.
3. Eventos pagos (`is_paid`, não `listing_only`) com `date` em abril.
4. Se **≥ 1 evento** teve **zero vendas** com `created_at` em abril → `ticket_inactivity_blocked = true`.
5. Gestor não cria evento nem reativa até resolver.
6. Job completo: e-mail ao gestor; se 2º mês seguido e taxa > 0 → cobrança `pending`.

**Liberar bloqueio:** desativar eventos pendentes em `company_ticket_inactivity_flags` **ou** Admin Master “Liberar inatividade”.

### Limitação conhecida (mês calendário)

O job compara **mês da data do evento** com **mês do `created_at` da venda**.

Exemplo: evento em **15/04**, vendas em **março** (pré-evento) → em 05/05 o sistema vê **0 vendas em abril** e pode bloquear indevidamente.

**Melhoria futura (fora do escopo fase 3):** contar vendas **desde a abertura das vendas até a data do evento**, não só no mês da data.

---

## Regra B — Auto-desativar vitrine (fase 3 — pendente)

**Critério proposto (após implementação):**

```
HOJE >= events.date + X dias
AND evento is_active = true
AND plano ∈ { ticket_commission, ticket_plus_consumption }
AND is_paid = true AND listing_only = false
AND zero vendas pagas desde o cadastro do evento (ou desde abertura de vendas — definir na implementação)
→ is_active = false (+ log opcional)
```

**Configuração Admin Master (a criar):**

| Campo | Chave sugerida | Default sugerido |
|-------|-----------------|------------------|
| Ativar auto-desativação | `ticket_inactivity_auto_deactivate_enabled` | `false` |
| Dias após a data do evento | `ticket_inactivity_auto_deactivate_days` | `30` (0 = off) |

**Job:** cron diário (independente do dia 5).

**Evento futuro / divulgação:** enquanto `HOJE < events.date + X`, **nada acontece** — o gestor pode divulgar sem risco de auto-desativar.

Detalhamento de implementação: `docs/PLANO_ANTI_FRAUDE_FASE3.md`.

---

## Fases de entrega

### Fase 1 — Bloqueio (implementado)

- Migration `20260712120000_ticket_sales_inactivity.sql`
- Flags, bloqueio criar/reativar, banner gestor, liberação admin/gestor

### Fase 2 — Cobrança, e-mail, cron (implementado)

- Migration `20260713120000_anti_fraud_phase2.sql`
- Fixes: `20260713130000`, `20260713140000`, `20260713150000`
- Edge: `run-ticket-inactivity-monthly-job`, `create-ticket-inactivity-checkout`
- UI: `TicketInactivityAdminSection`, pagamento em `CompanyBillingPlanSection`
- Cron: `ticket_inactivity_monthly_check` (dia 5)

### Fase 3 — Itens pendentes

Ver `docs/PLANO_ANTI_FRAUDE_FASE3.md` — **implementado**:

1. Auto-desativar vitrine (regra B acima)
2. Tela admin cobranças de inatividade
3. Receita admin incluir taxa de inatividade
4. Log bypass em lotes e cadastro de ingressos

### Extra implementado (fora do plano original)

- Relatório Admin Master: estoque de ingressos por empresa/evento — migration `20260714120000`, rota `/manager/reports/admin-ticket-inventory`

---

## Migrations (ordem de deploy)

1. `20260712120000_ticket_sales_inactivity.sql`
2. `20260713120000_anti_fraud_phase2.sql`
3. `20260713130000_fix_admin_bypass_log_actor_email.sql`
4. `20260713140000_fix_inactivity_job_charge_errors.sql`
5. `20260713150000_fix_jsonb_agg_order_by.sql`
6. `20260714120000_admin_companies_event_ticket_inventory.sql` (relatório)
7. `20260715120000_anti_fraud_phase3_bypass_log.sql`
8. `20260715130000_anti_fraud_phase3_admin_charges_revenue.sql`
9. `20260715140000_anti_fraud_phase3_auto_deactivate.sql`

---

## Homologação

Checklist completo: `docs/CHECKLIST_TESTES_ANTI_FRAUDE.md`

- [ ] Toggle `ticket_inactivity_enabled` desliga job
- [ ] Empresa com evento em mar/2026, 0 vendas em mar → bloqueio em 05/abr
- [ ] Evento futuro → sem bloqueio no dia 5
- [ ] Desativar eventos pendentes → bloqueio removido
- [ ] Cobrança após 2 meses + checkout MP
- [ ] (Fase 3) Auto-desativar após X dias pós-data do evento
