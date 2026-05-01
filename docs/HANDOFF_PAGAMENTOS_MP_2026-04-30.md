# Handoff - Pagamentos Mercado Pago (2026-04-30)

## Contexto

Fluxo de compra com Mercado Pago evoluiu de um estado com erro de política (403) e inconsistências de sincronização para um estado com:

- criação de preferência funcional;
- rastreabilidade de pagamento no banco;
- UX de compras separada de UX de ingressos;
- mecanismo de reconciliação manual via API para investigar pendências;
- correção de idempotência no webhook para não "ignorar" transações pagas incompletas.

## Fases concluídas

### Fase 1 - Base de rastreabilidade em pagamentos

- Migration criada: `supabase/migrations/20260430170000_receivables_payment_tracking_fields.sql`
- Novos campos em `receivables`:
  - `payment_status`
  - `mp_payment_id`
  - `mp_preference_id`
  - `mp_status_detail`
  - `gross_amount`
  - `mp_fee_amount`
  - `net_amount_after_mp`
  - `paid_at`
- Índices adicionados para status e IDs do gateway.

### Fase 2 - Ajustes no create-payment-preference

- Arquivo: `supabase/functions/create-payment-preference/index.ts`
- Na criação da transação (`receivables`), já grava:
  - `payment_status='pending'`
  - `gross_amount=totalValue`
- Após criar preferência MP:
  - grava `mp_preference_id` e mantém status de pagamento pendente.
- Endurecimento da origem de `back_urls` para reduzir bloqueio PolicyAgent:
  - priorização de `SITE_URL` por padrão;
  - flags de controle para origem dinâmica/localhost.

### Fase 3 - Webhook e financeiro

- Arquivo: `supabase/functions/mercadopago-webhook/index.ts`
- Persistência de status e IDs do MP em `receivables`.
- Persistência de valores financeiros do MP:
  - bruto, taxa MP e líquido pós-MP.
- Split financeiro ajustado para usar base real da operação:
  - comissão plataforma sobre bruto;
  - líquido organizador considerando pós-MP.
- Ingresso pós-pagamento marcado como `active` (não `used`).
- `event_data` de ingresso recebe dados financeiros da compra.

### Fase 4 - UX cliente e gestor (pagamentos visíveis)

- Cliente:
  - nova seção `Minhas Compras` em `src/pages/MyTickets.tsx`
  - dados via novo hook `src/hooks/use-my-purchases.tsx`
- Gestor:
  - seção de transações em `src/pages/FinancialReports.tsx`
  - dados via novo hook `src/hooks/use-manager-transactions.tsx`

### Fase 5 - Diagnóstico e reconciliação manual

- Nova Edge Function: `supabase/functions/check-payment-status/index.ts`
- Consulta status no MP por transação.
- Atualiza campos de rastreio em `receivables`.
- Botão "Verificar no MP" disponível para cliente e gestor.
- Retorno inclui dados para troubleshooting (`processingResult`, `requiresAttention`, etc).

### Fase 6 - Correção de consistência (paid sem ingresso emitido)

- Webhook ajustado para idempotência robusta:
  - se `receivable` estiver `paid`, verifica se ingressos e splits foram concluídos;
  - se incompleto, reprocessa em vez de ignorar.

## Estado atual (fim do dia)

- Compras aparecem para cliente com status de pagamento.
- UX agora prioriza status do gateway para feedback visual (ex.: aprovado no MP aparece como "Pago").
- A emissão do ingresso depende da conclusão completa da rotina do webhook/reprocessamento.
- Foi identificado cenário real: transação aprovada no MP com pendência de atribuição de ingressos (inconsistência tratada na última correção do webhook).

## O que falta (próxima sessão)

1. **Aplicação operacional das mudanças**
   - Rodar migration no ambiente.
   - Deploy de funções:
     - `create-payment-preference`
     - `mercadopago-webhook`
     - `check-payment-status`

2. **Validação ponta a ponta (obrigatória)**
   - Fazer compra PIX real.
   - Confirmar:
     - `receivables.status` vira `paid`
     - `wristband_analytics` vinculados ao cliente com `status='active'`
     - `financial_splits` inserido (sem duplicidade)
     - exibição em `Minhas Compras` + `Ingressos Ativos`

3. **Ajuste de regra de negócio a confirmar com produto**
   - Comissão da plataforma: manter sobre bruto ou migrar para líquido pós-MP.
   - Exibir "Pago (aguardando emissão)" quando gateway aprovado e atribuição ainda pendente (estado intermediário explícito).

4. **Hardening técnico**
   - Criar rotina de reconciliação agendada para pendências antigas.
   - Criar tabela de auditoria de eventos de pagamento (`payment_events`) para trilha completa e reprocessamento seguro.
   - Adicionar paginação/filtro por status na lista de compras/transações.

## Atualização 2026-05-01 (fases finalizadas)

- [x] Tabela de auditoria criada: `payment_events` (migration `20260501134000_create_payment_events.sql`).
- [x] Webhook e verificação manual passaram a registrar eventos em `payment_events`.
- [x] UX com estado intermediário explícito:
  - `Pago (aguardando emissão)` quando gateway está aprovado e integração local ainda não finalizou.
- [x] Filtro + paginação implementados:
  - cliente (`Minhas Compras`) por status e páginas;
  - gestor (`Transações de Pagamento`) por status e páginas.
- [x] Rotina de reconciliação criada:
  - Edge Function `reconcile-pending-payments` para varrer pendências e reprocessar webhook.

## Checklist final de operação

1. Aplicar migrations:
   - `20260430170000_receivables_payment_tracking_fields.sql`
   - `20260501134000_create_payment_events.sql`
2. Fazer deploy das funções:
   - `create-payment-preference`
   - `mercadopago-webhook`
   - `check-payment-status`
   - `reconcile-pending-payments`
3. Configurar secret opcional para reconciliação:
   - `RECONCILIATION_TOKEN` (recomendado para proteger execução manual/cron)
4. Executar teste PIX ponta a ponta:
   - comprar -> retornar -> verificar em `Minhas Compras` -> emitir em `Ingressos Ativos`.
5. Auditar no banco por `transaction_id`:
   - `receivables` (status e campos MP),
   - `financial_splits` (2 lançamentos esperados),
   - `wristband_analytics` (vínculo cliente + `status='active'`),
   - `payment_events` (trilha dos eventos webhook/manual/system).
6. Rodar reconciliação de pendentes (se necessário):
   - invocar `reconcile-pending-payments` com `olderThanMinutes` e `limit`.

## Riscos conhecidos

- Reprocessamento via chamada da função de diagnóstico para webhook depende de endpoint disponível e sem bloqueio de rede.
- Se webhook estiver com erro silencioso em um ponto específico de DB, compra pode mostrar "Pago" na UX antes da emissão do ingresso (mitigado parcialmente com `requiresAttention`).

## Checklist de retomada amanhã

1. Garantir migration aplicada.
2. Confirmar deploy das 3 funções.
3. Executar 1 compra PIX de teste.
4. Clicar "Verificar no MP".
5. Auditar as 3 tabelas-chave (`receivables`, `wristband_analytics`, `financial_splits`).
6. Ajustar qualquer divergência remanescente antes de novos fluxos.

