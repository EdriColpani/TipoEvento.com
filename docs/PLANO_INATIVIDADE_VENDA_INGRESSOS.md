# Plano: Inatividade de venda de ingressos (anti-fraude)

**Status:** Completo (bloqueio + cobrança 2 meses + e-mail + cron)  
**Última atualização:** 2026-06-02

## Decisões fechadas

| # | Decisão |
|---|---------|
| 1 | Escopo **por empresa** (não por evento isolado no bloqueio) |
| 2 | Só eventos cuja **data já caiu no mês de referência** (mês calendário anterior) |
| 3 | **v1:** apenas bloqueio — sem cobrança automática |
| 4 | Taxa fixa global reservada para **v2** (`ticket_inactivity_fee_default` no admin) |
| 5 | Planos **híbrido** e **comissão:** regra só sobre **ingressos** (ignora consumo) |

## Comportamento

1. Job (dia **5** de cada mês) analisa o **mês anterior** (`reference_month`).
2. Empresas em `ticket_commission` ou `ticket_plus_consumption`.
3. Eventos pagos (`is_paid`, não `listing_only`) com `date` no mês de referência.
4. Se **≥ 1 evento** com **zero vendas de ingresso** no mês → `companies.ticket_inactivity_blocked = true`.
5. Gestor **não cria** novo evento nem **reativa** evento até resolver.
6. Resolver: **desativar** cada evento listado em `company_ticket_inactivity_flags` (auto-libera) ou Admin Master liberar.
7. Admin Master: bypass nas validações.

## Vendas contabilizadas

`receivables` pagos (`status = paid` ou `payment_status` aprovado/autorizado) com `created_at` no mês de referência, por `event_id`.

## Migrations

- `20260712120000_ticket_sales_inactivity.sql`
- `20260713120000_anti_fraud_phase2.sql`

## Homologação

- [ ] Empresa com evento em mar/2026, 0 vendas em mar → bloqueio em 05/abr
- [ ] Empresa com venda em pelo menos um evento do mês → sem bloqueio
- [ ] Desativar eventos pendentes → bloqueio removido
- [ ] Admin Master libera manualmente
- [ ] Plano vitrine / consumo → ignorado

## Fase 2 — implementada

- Cobrança da taxa fixa global após **2 meses consecutivos** (`company_ticket_inactivity_charges`)
- Checkout MP: `create-ticket-inactivity-checkout`
- E-mail ao gestor (`company_ticket_inactivity_notifications` + `run-ticket-inactivity-monthly-job`)
- Cron `pg_cron` dia 5: `ticket_inactivity_monthly_check`
- UI gestor: pagamento em Plano e cobrança

Checklist completo: `docs/CHECKLIST_TESTES_ANTI_FRAUDE.md`
