# Plano: Mínimo de ingressos por evento (anti-fraude)

**Status:** Implementado (v1 + fase 2)  
**Última atualização:** 2026-06-02

## Regras de negócio

| Regra | Comportamento |
|-------|----------------|
| Padrão global | Admin Master define em **Preços e comissões → Cobrança de ingressos** (default: 10) |
| Por empresa | Override em **Planos das Empresas**; flag `min_event_tickets_customized` |
| Propagação global | Alterar global atualiza só empresas com `customized = false` |
| Nova empresa | Herda o padrão global no INSERT (`trigger`) |
| Planos afetados | `ticket_commission`, `ticket_plus_consumption` |
| Evento gratuito no gestor | Oculto; evento sempre pago nesses planos |
| Lotes (criação/edição) | Soma das quantidades ≥ mínimo ao salvar evento |
| Cadastro de ingressos | Total ativo após gravar ≥ mínimo (valor > 0) |
| Ativar na vitrine | Ingressos ativos ≥ mínimo (trigger em `events`) |
| Bypass | Somente **Admin Master** (suporte); gestor sem bypass |
| Vitrine / consumo | Sem mínimo de ingressos pagos |

## Migrations (ordem)

1. `20260711120000_min_event_tickets_enforcement.sql` — colunas, RPCs, trigger em `events`
2. `20260711130000_enforce_min_event_batch_quantity.sql` — trigger em `event_batches`
3. `20260711140000_event_active_ticket_count_analytics.sql` — contagem por analytics + trigger
4. `20260713120000_anti_fraud_phase2.sql` — log bypass Admin Master + badge na lista

## Front-end

| Área | Arquivo |
|------|---------|
| Admin global | `MinEventTicketsDefaultSection.tsx` |
| Admin empresa | `AdminCompanyBillingEditDialog.tsx`, `AdminCompaniesBilling.tsx` |
| Gestor plano | `CompanyBillingPlanSection.tsx` |
| Criar/editar evento | `EventFormSteps.tsx` |
| Pós-criação | `ManagerCreateEvent.tsx` (modal obrigatório em planos com ingressos) |
| Cadastro ingresso | `ManagerCreateWristband.tsx` |
| Ativar evento | `EventActiveToggle.tsx` |
| Badge “faltam ingressos” | `ManagerEventsList.tsx`, `use-event-ticket-readiness.tsx` |
| Log bypass Admin Master | `AdminMasterBypassLogSection.tsx` |
| Utilitários | `min-event-tickets-validation.ts`, `min-event-tickets-errors.ts` |

## Homologação

- [ ] Global 10 → nova empresa herda 10
- [ ] Override empresa 15 → não muda ao alterar global
- [ ] Restaurar padrão global na empresa
- [ ] Criar evento: lotes com soma &lt; mínimo → erro ao salvar
- [ ] Cadastrar ingressos: quantidade &lt; mínimo → erro ao gravar
- [ ] Ativar evento sem ingressos suficientes → erro
- [ ] Plano vitrine: sem validação de mínimo pago
- [ ] Admin Master: bypass nas triggers

## Fase 2 — implementada

- Log de bypass Admin Master (`admin_master_bypass_log`)
- Badge **Faltam ingressos** na lista de eventos desativados

Checklist completo: `docs/CHECKLIST_TESTES_ANTI_FRAUDE.md`
