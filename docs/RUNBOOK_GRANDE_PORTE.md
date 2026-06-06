# Runbook operacional — Eventos de grande porte

Checklist e procedimentos para o dia da venda e incidentes de checkout.

---

## Antes da abertura (D-1 / H-2)

- [ ] **Checklist go-live completo** na edição do evento (`/manager/events/edit/:id`)
- [ ] Evento com **grande porte** (`inventory_mode=counter`) e lotes conferidos
- [ ] Soma dos lotes = capacidade real anunciada
- [ ] Fila virtual ligada se pico esperado > 1.000 simultâneos
- [ ] Webhook assíncrono ativo (`checkout_async_webhook`)
- [ ] Teste de carga k6 executado — `verify-integrity` com `ok: true`
- [ ] Dashboard admin: `/admin/settings/checkout-observability`
- [ ] Credenciais MP do gestor validadas
- [ ] Equipe sabe quem pausa vendas e como comunicar

---

## Métricas a monitorar (dashboard)

| Métrica | Alerta amarelo | Alerta vermelho |
|---------|----------------|-----------------|
| Webhook jobs pendentes | ≥ 25 | ≥ 100 |
| Checkouts pendentes | ≥ 100 | ≥ 500 |
| Integridade estoque | qualquer violação | — |
| Fila aguardando | ≥ 500 | ≥ 5.000 |
| Conflitos reserva/min | alto vs baseline | overselling detectado |

Atualização automática a cada 15 s no dashboard admin.

---

## Pausar vendas (emergência)

1. Admin ou gestor: **desativar evento** (`is_active = false`) na lista de eventos
2. Confirmar que novos checkouts retornam erro “evento não disponível”
3. Comunicar gestor e suporte
4. **Não** apagar registros de `receivables` ou `batch_inventory` manualmente

Reativar somente após causa raiz identificada e estoque conferido via `verify_event_inventory_integrity`.

---

## Incidentes comuns

### Webhook MP atrasado

**Sintomas:** muitos `pending_receivables`, jobs em `payment_webhook_jobs`.

**Ação:**

1. Verificar fila no dashboard
2. Invocar worker manualmente (service role):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/process-payment-webhook-jobs" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 25}'
```

3. Se persistir: checar logs `mercadopago-webhook` no Supabase Dashboard

### Fila virtual parada

**Sintomas:** usuários presos em “aguardando”, `queue_admitted` = 0.

**Ação:**

1. Confirmar pg_cron `event_checkout_queue_admit` ativo
2. RPC manual:

```sql
SELECT public.admit_event_checkout_queue_batch('EVENT_UUID'::uuid, 200);
```

### Suspeita de overselling

**Ação imediata:** pausar vendas.

```sql
SELECT public.verify_event_inventory_integrity('EVENT_UUID'::uuid);
```

Se `ok = false`, escalar para engenharia com snapshot de `batch_inventory` e `receivables`.

### Reservas fantasma (estoque preso)

**Sintomas:** `reserved` alto, poucos pagamentos.

**Ação:**

```sql
SELECT public.expire_stale_ticket_checkout_reservations(1000);
```

Job pg_cron `ticket_checkout_expire_stale` roda a cada 15 min — confirmar execução.

---

## Teste de carga (go/no-go)

```bash
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_ANON_KEY=...
export AUTH_TOKEN=...   # JWT usuário teste
export EVENT_ID=...
export WRISTBAND_ID=...

k6 run load-tests/availability.js
STRESS_VUS=50 k6 run load-tests/checkout-reserve-stress.js
k6 run load-tests/verify-integrity.js
```

**Go:** integridade OK, p95 disponibilidade dentro do SLO, zero violações.

**No-go:** qualquer overselling, integridade falha, ou latência p95 > 2× baseline.

---

## Contatos e escalação

| Nível | Responsável | Ação |
|-------|-------------|------|
| L1 | Suporte / gestor | Pausar evento, comunicar público |
| L2 | Admin master | Dashboard, worker webhook, fila |
| L3 | Engenharia | SQL, migrations, MP/Supabase |

---

## Pós-evento

- [ ] Revisar `checkout_ops_events` no dashboard
- [ ] Confirmar `sold + reserved <= total` em todos os lotes
- [ ] Arquivar resultados do k6 e métricas do dia D
- [ ] Retrospectiva: SLOs atingidos?

---

*Documento operacional — complementa `docs/PLANO_GRANDE_PORTE_INGRESSOS.md`.*
