# Plano de ação — Vendas de ingressos em eventos de grande porte

**Status:** Fases 1–5 implementadas (2026-06-06)  
**Data:** 2026-06-02  
**Contexto:** EventFest — checkout Mercado Pago, estoque em `wristband_analytics`, Supabase + Edge Functions

---

## Status de implementação

| Fase | Status | Observação |
|------|--------|------------|
| **Fase 1** | Implementado | RPC reserva atômica, índices, TTL 15 min |
| **Fase 2** | Implementado | `inventory_mode=counter`, `batch_inventory`, materialização no webhook |
| **Fase 3** | Implementado | Fila virtual, cache 3s, rate limit, webhook assíncrono |
| **Fase 4** | Implementado | Teste de carga k6, dashboard observabilidade, runbook |
| **Fase 5** | Implementado | Checklist go-live gestor + bloqueio de ativação |

### Fase 4 — arquivos principais

| Item | Arquivo |
|------|---------|
| Logs + métricas SQL | `20260719120000_ticket_observability_phase4.sql` |
| Dashboard admin | `AdminCheckoutObservability.tsx`, `/admin/settings/checkout-observability` |
| Testes k6 | `load-tests/` |
| Runbook | `docs/RUNBOOK_GRANDE_PORTE.md` |

### Fase 5 — arquivos principais

| Item | Arquivo |
|------|---------|
| Checklist SQL | `20260720120000_event_go_live_checklist_phase5.sql` |
| UI gestor | `EventGoLiveChecklist.tsx`, `ManagerEditEvent.tsx` |
| Bloqueio ativação | `EventActiveToggle.tsx` |
| Hook | `use-event-go-live-checklist.tsx` |

### Fase 3 — arquivos principais

| Item | Arquivo |
|------|---------|
| Fila + rate limit + cache + jobs SQL | `20260718120000_ticket_high_traffic_phase3.sql` |
| API fila | `event-checkout-queue` edge function |
| Worker webhook | `process-payment-webhook-jobs` + `mercadopago-webhook` (async) |
| UX fila | `use-event-checkout-queue.tsx`, `EventDetails.tsx` |

### Fase 2 — arquivos principais

| Item | Migration / arquivo |
|------|---------------------|
| `events.inventory_mode` | `20260717120000_ticket_counter_inventory_phase2.sql` |
| `batch_inventory` + sync por lote | idem |
| Reserva counter no checkout | `reserve_tickets_for_mp_checkout` (idem) |
| Materialização pós-pagamento | `materialize_counter_checkout_tickets` + `mercadopago-webhook` |
| Disponibilidade pública | RPC `get_event_ticket_availability` + `use-event-details.tsx` |
| UI gestor | `EventFormSteps.tsx` — checkbox “Evento de grande porte” |

---

## Resumo executivo

O sistema **não está preparado hoje** para eventos com **dezenas ou centenas de milhares de ingressos** e **milhares de compradores simultâneos**, sem risco de overselling, lentidão crítica ou falhas operacionais.

Funciona bem para **volume médio/pequeno** (centenas ou alguns milhares de ingressos, picos moderados). Este plano descreve **5 fases** para evoluir a arquitetura até suportar mega eventos com segurança.

| Fase | Foco | Prazo estimado |
|------|------|----------------|
| 0 | Metas, piloto, runbook | 1–2 semanas |
| 1 | Reserva atômica, índices, TTL (quick wins) | 2–3 semanas |
| 2 | Estoque contador + materialização tardia | 4–6 semanas |
| 3 | Fila virtual, webhook assíncrono, cache | 3–4 semanas |
| 4 | Teste de carga, observabilidade, go-live | 2–3 semanas (paralelo) |

**Recomendação imediata:** aprovar Fase 0 + Fase 1 antes de prometer eventos acima de ~10 mil ingressos com pico alto.

---

## 1. Situação atual (diagnóstico)

### 1.1 Modelo de estoque

- Cada ingresso = **1 linha** em `wristband_analytics`.
- 100 mil ingressos = 100 mil registros criados antes ou durante a operação.
- Lotes comerciais existem em `event_batches`, mas a **venda efetiva** ainda depende de pulseiras materializadas em `wristband_analytics`.
- Cadastro na UI limitado a **500 ingressos por operação** (`ManagerCreateWristband`).

### 1.2 Checkout Mercado Pago

- Edge function `create-payment-preference`:
  1. `SELECT` N registros disponíveis (sem lock).
  2. `INSERT` em `receivables`.
  3. `UPDATE` status `pending` com verificação otimista.
- **Não usa** `FOR UPDATE SKIP LOCKED` (diferente do fluxo de crédito em `credit_phase3_spend_tickets`).

### 1.3 Fluxo de crédito (referência positiva)

- RPC `process_credit_spend` (e variantes) reserva com:

```sql
SELECT wa.id
FROM public.wristband_analytics wa
WHERE wa.wristband_id = v_wristband_id
  AND wa.status = 'active'
  AND wa.client_user_id IS NULL
ORDER BY wa.id
LIMIT v_qty
FOR UPDATE SKIP LOCKED;
```

- Esse padrão deve ser replicado no checkout MP.

### 1.4 Gaps identificados

| Gap | Impacto | Prioridade |
|-----|---------|------------|
| 1 linha = 1 ingresso materializado | INSERT lento, tabela enorme, queries pesadas | Alta |
| Checkout MP sem lock atômico | Overselling / erros em massa no pico | **Crítica** |
| `event_batches` ≠ estoque real de reserva | Desalinhamento comercial vs operacional | Média |
| Sem fila / waiting room | Supabase + MP sob stress no “sold out em 2 min” | Alta |
| Sem teste de carga | Risco desconhecido antes do go-live | **Crítica** |
| Webhook síncrono pesado | Atraso na confirmação; estoque preso em `pending` | Alta |
| Índice ausente para disponibilidade | Scan lento em tabelas grandes | Alta |

### 1.5 Fluxo atual (simplificado)

```
Gestor cadastra pulseiras
  → N linhas em wristband_analytics
  → Checkout SELECT limit N
  → UPDATE status pending
  → Mercado Pago + webhook mercadopago-webhook
```

**Riscos no pico:** consulta lenta, corrida entre compradores, edge function saturada, fila de webhooks.

---

## 2. Metas e critérios de sucesso (SLOs)

Definir **antes** de implementar. Valores sugeridos:

| Métrica | Evento médio | Evento grande | Mega evento |
|---------|--------------|---------------|-------------|
| Ingressos totais | até 10 mil | 10–50 mil | 50–150 mil+ |
| Pico simultâneo | 200 compradores | 1–3 mil | 5–15 mil |
| Overselling | 0 | 0 | 0 |
| p95 checkout (até redirect MP) | < 3 s | < 5 s | < 8 s (com fila) |
| Disponibilidade no pico | 99,5% | 99,9% | 99,9% |

**Regra de ouro:** nunca confiar só em SELECT + UPDATE separados para estoque quente. Toda reserva deve ser **atômica no Postgres** (ou contador externo com consistência forte).

---

## 3. Fase 0 — Preparação (1–2 semanas)

### Entregas

- Definir SLOs por tipo de evento (tabela acima).
- Escolher **evento piloto**: sandbox ou evento real escalonado (5k → 20k → 50k simulados).
- Baseline de performance: latência checkout, QPS webhook, tamanho de `wristband_analytics`.
- Runbook operacional: queda MP, Supabase, fila, pausar vendas, comunicação ao gestor.

### Decisões de negócio

- Tempo máximo de reserva no carrinho (ex.: 10–15 min).
- Fila virtual antes da página de compra? (recomendado para mega eventos).
- Venda em ondas (pré-venda, lote 1, lote 2) vs abertura única.
- Limite de ingressos por CPF/compra.

---

## 4. Fase 1 — Correções urgentes (2–3 semanas)

*Ganho rápido sem reescrever o modelo inteiro. Objetivo: eventos até ~5–10 mil ingressos com pico moderado.*

### 4.1 Reserva atômica no checkout MP

Migrar lógica de `create-payment-preference` para **RPC Postgres** (mesmo padrão do crédito):

- Uma transação: reserva (`FOR UPDATE SKIP LOCKED`) → `receivables` → retorno dos IDs.
- Edge function apenas chama RPC + cria preferência MP.
- **Idempotency key** por tentativa de checkout (evita duplicar reserva ao retentar).

**Arquivos impactados (estimativa):**

- Nova migration: `reserve_tickets_for_checkout(...)` ou similar.
- `supabase/functions/create-payment-preference/index.ts` — delegar reserva ao RPC.
- Testes manuais + cenário de concorrência.

### 4.2 Índices para estoque quente

```sql
CREATE INDEX CONCURRENTLY idx_wa_availability
ON public.wristband_analytics (wristband_id, id)
WHERE status = 'active' AND client_user_id IS NULL;
```

Índices adicionais em `receivables(status, created_at)` para reconciliação de pendentes.

### 4.3 TTL de reservas `pending`

- Job (pg_cron ou edge) libera reservas `checkout_pending` após X minutos sem pagamento.
- Reduz estoque “fantasma” no pico.
- Ampliar ou complementar `reconcile-pending-payments`.

### 4.4 Infra Supabase imediata

- **Supavisor** (pool de conexões) habilitado.
- Revisar plano Supabase (compute + conexões) para dia de venda.
- Timeout e retry documentados nas edge functions.

---

## 5. Fase 2 — Novo modelo de estoque (4–6 semanas)

*Essencial para 50k–150k ingressos. Materializar 100 mil linhas antes da venda não escala.*

### 5.1 Modelo alvo: contador + materialização tardia

| Camada | Papel |
|--------|--------|
| `event_batches` | Capacidade comercial (quantidade, preço, janela) |
| `batch_inventory` (nova tabela) | `total`, `sold`, `reserved`, `available` por lote |
| `wristband_analytics` | Criado **só na confirmação do pagamento** (ou worker assíncrono) |

### 5.2 Fluxo proposto

1. Checkout decrementa `available` com update atômico por lote:

```sql
UPDATE batch_inventory
SET reserved = reserved + :qty,
    available = available - :qty
WHERE batch_id = :id AND available >= :qty
RETURNING *;
```

2. Pagamento aprovado → worker gera N registros `wristband_analytics` + QR.
3. Cancelamento/expiração → devolve contador.

### 5.3 Compatibilidade

- Feature flag por evento: `inventory_mode = 'unit_rows' | 'counter'`.
- Eventos pequenos mantêm modelo legado.
- Anti-fraude, relatórios admin e validação na porta adaptados ao modo contador.

### 5.4 Cadastro em massa

- Remover ou flexibilizar limite 500 na UI para eventos “grande porte”.
- Import CSV ou job único: criar capacidade 100k sem centenas de operações manuais.

---

## 6. Fase 3 — Concorrência extrema e fila (3–4 semanas)

Para **milhares simultâneos** no minuto zero da venda.

### 6.1 Fila virtual (waiting room)

- Antes de `/event/:id/checkout`, token de entrada (Redis/Upstash ou edge KV).
- Libera N usuários/minuto conforme capacidade medida.
- UX: “Você está na fila — posição X”.

### 6.2 Cache de leitura

- “Disponível / esgotado / em breve” servido por cache (TTL 2–5 s).
- Escrita sempre no Postgres (fonte da verdade).

### 6.3 Webhook assíncrono

- `mercadopago-webhook`: ack rápido → enfileira job (`pgmq`, Supabase Queue ou tabela `payment_jobs`).
- Worker confirma pagamento, materializa ingressos, envia e-mail.
- Evita timeout da edge no pico.

### 6.4 Rate limit

- Por IP + usuário + evento.
- Proteção contra bots e scraping de disponibilidade.

---

## 7. Fase 4 — Testes, observabilidade e go-live (2–3 semanas)

Pode rodar **em paralelo** à Fase 1, intensificando antes do primeiro mega evento.

### 7.1 Teste de carga (obrigatório)

Ferramenta sugerida: **k6** ou **Artillery**.

| Cenário | Carga alvo |
|---------|------------|
| Disponibilidade | 500 req/s leitura |
| Checkout | 50 → 200 → 500 req/s reserva |
| Webhook | 100 pagamentos/s |
| Expiração | 10k reservas pending expirando |

**Critério de aprovação:** zero overselling com estoque fixo (ex.: 1.000 ingressos, 2.000 tentativas).

### 7.2 Monitoramento

- Dashboard: reservas/min, pagos/min, pendentes, erros 409, latência RPC.
- Alertas: fila webhook > limiar, reservas pending > limiar, erro MP.
- Log estruturado por `event_id` + `correlation_id`.

### 7.3 Mercado Pago

- Validar limites da conta (volume, split marketplace).
- Webhook redundante + reconciliação (`reconcile-pending-payments` ampliado).

### 7.4 Dia do evento (validação na porta)

- `validate-ticket` com escala separada do checkout.
- Plano B offline documentado (validação degradada / lista sincronizada).

---

## 8. Fase 5 — Operação comercial (checklist pré-venda)

Checklist gestor + admin antes de abrir venda de mega evento:

- [ ] Evento marcado como grande porte / modo contador (quando Fase 2 existir).
- [ ] Estoque e lotes conferidos (soma = capacidade real).
- [ ] Teste de carga aprovado para capacidade do evento.
- [ ] Fila virtual configurada (se pico esperado > 1.000 simultâneos).
- [ ] Runbook: quem aciona, como pausar vendas, como comunicar gestor.
- [ ] Janela de “soft open” (equipe interna) antes da abertura pública.
- [ ] Suporte reforçado nas primeiras 2 horas de venda.

---

## 9. Roadmap sugerido

```
Semanas 1–2   → Fase 0 (SLOs, piloto, runbook)
Semanas 3–5   → Fase 1 (RPC checkout, índices, TTL)     ← prioridade máxima
Semanas 3–8   → Fase 4 em paralelo (baseline + load test inicial)
Semanas 6–11  → Fase 2 (estoque contador)
Semanas 12–15 → Fase 3 (fila + webhook async)
Antes do D-day → Load test final + go/no-go
```

**Ordem recomendada:** Fase 0 → **Fase 1 imediatamente** → Fase 4 em paralelo → Fase 2 antes de prometer 50k+ → Fase 3 antes do primeiro mega evento.

---

## 10. O que NÃO fazer

- Prometer 100k ingressos **só** subindo plano Supabase, sem mudar reserva/estoque.
- Materializar 100k QR codes antes da venda “por precaução”.
- Abrir venda única sem fila se expectativa > 1.000 simultâneos.
- Ir a produção sem teste que **prova** zero overselling.

---

## 11. Investimento estimado (ordem de grandeza)

| Item | Esforço dev | Infra extra |
|------|-------------|-------------|
| Fase 1 (RPC + índices + TTL) | 1 dev × 2–3 sem | Baixo |
| Fase 2 (estoque contador) | 1–2 dev × 4–6 sem | Baixo |
| Fase 3 (fila + async) | 1 dev × 3–4 sem | Redis/Upstash ~US$ 20–100/mês no pico |
| Fase 4 (load test + ops) | 0,5 dev × 2–3 sem | k6 (free) |
| Supabase upgrade no dia D | — | Conforme plano (compute burst) |

---

## 12. Referências no código

| Componente | Caminho |
|------------|---------|
| Checkout MP | `supabase/functions/create-payment-preference/index.ts` |
| Webhook MP | `supabase/functions/mercadopago-webhook/` |
| Reserva atômica (crédito) | `supabase/migrations/20260622120000_credit_phase3_spend_tickets.sql` |
| Cadastro pulseiras | `supabase/functions/create-wristbands-batch/index.ts` |
| Lotes comerciais | `supabase/migrations/20260701140000_event_batches_rls.sql` |
| Reconciliação pendentes | `supabase/functions/reconcile-pending-payments/index.ts` |
| Validação entrada | `supabase/functions/validate-ticket/` |
| UI limite 500 | `src/pages/ManagerCreateWristband.tsx` |

---

## 13. Próximos passos (quando aprovar)

1. Validar SLOs e escolher evento piloto (Fase 0).
2. Implementar Fase 1 — RPC de reserva atômica no checkout MP.
3. Agendar teste de carga com cenário realista do piloto.
4. Decidir data-alvo para Fase 2 (contador) conforme pipeline comercial de mega eventos.

---

*Documento gerado para análise interna. Não substitui teste de carga nem revisão de limites Mercado Pago / Supabase no ambiente de produção.*
