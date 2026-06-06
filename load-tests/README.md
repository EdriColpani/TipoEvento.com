# Testes de carga — EventFest (Fase 4)

Scripts [k6](https://k6.io/) para validar disponibilidade, reserva e integridade de estoque antes de mega eventos.

## Pré-requisitos

```bash
# Windows (chocolatey) ou https://k6.io/docs/get-started/installation/
choco install k6

# macOS
brew install k6
```

Variáveis de ambiente (copie `.env.example` ou exporte no shell):

| Variável | Descrição |
|----------|-----------|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave anon |
| `EVENT_ID` | UUID do evento piloto (modo counter recomendado) |
| `AUTH_TOKEN` | JWT de usuário de teste (para checkout) |
| `WRISTBAND_ID` | UUID do tipo de ingresso / pulseira do lote |

## Cenários

### 1. Disponibilidade (leitura)

```bash
k6 run load-tests/availability.js
```

Meta: p95 &lt; 500 ms em RPC `get_event_ticket_availability`.

### 2. Integridade pós-teste

```bash
k6 run load-tests/verify-integrity.js
```

Chama `verify_event_inventory_integrity` — **deve retornar `ok: true`** após qualquer teste de reserva.

### 3. Reserva concorrente (overselling)

```bash
k6 run load-tests/checkout-reserve-stress.js
```

Simula N usuários tentando reservar simultaneamente. Critério go/no-go:

- Estoque fixo (ex.: 1.000) + 2.000 tentativas → **zero violações** em `batch_inventory` ou `wristband_analytics`.
- Conflitos HTTP 409 são esperados; overselling **não**.

> **Atenção:** o cenário 3 chama a edge `create-payment-preference` e consome estoque real. Use **evento sandbox** ou restaure estoque após o teste.

## Ordem recomendada

1. `availability.js` — baseline
2. Configurar evento piloto com estoque conhecido (ex.: 1.000)
3. `checkout-reserve-stress.js` — carga moderada (ajuste `vus` no script)
4. `verify-integrity.js` — go/no-go
5. Repetir com fila virtual ligada (`checkout_queue_enabled`)

## Referências

- Plano completo: `docs/PLANO_GRANDE_PORTE_INGRESSOS.md`
- Runbook operacional: `docs/RUNBOOK_GRANDE_PORTE.md`
- Dashboard admin: `/admin/settings/checkout-observability`
