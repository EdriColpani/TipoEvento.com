# Testes de carga — EventFest (Fase 4 + portaria/consumo)

Scripts [k6](https://k6.io/) para validar checkout, portaria, consumo e integridade de estoque.

## Pré-requisitos

```bash
# Windows
choco install k6

# macOS
brew install k6
```

## Variáveis de ambiente

| Variável | Scripts | Descrição |
|----------|---------|-----------|
| `SUPABASE_URL` | todos | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | todos | Chave anon |
| `EVENT_ID` | checkout, crédito ingresso, consumo (opc.) | UUID do evento piloto |
| `WRISTBAND_ID` | checkout, crédito ingresso | UUID do lote / tipo ingresso |
| `AUTH_TOKEN` | checkout, crédito | JWT de **um** usuário |
| `AUTH_TOKENS` | crédito, consumo | JWTs separados por vírgula (pool — **recomendado**) |
| `UNIT_PRICE` | checkout, crédito ingresso | Preço unitário (default 10) |
| `STRESS_VUS` | stress | Virtual users (default varia por script) |
| `STRESS_DURATION` | stress | Duração (ex.: `2m`) |
| `SLEEP_SECONDS` | stress | Pausa entre iterações |
| `VALIDATION_API_KEY` | portaria | Chave 8 chars `entry_exit` |
| `WRISTBAND_CODES` | portaria | Códigos QR/UUID csv (pool) |
| `WRISTBAND_CODE` | portaria | Um código só (alternativa) |
| `VALIDATION_TYPE` | portaria | `entry` \| `exit` \| `auto` |
| `CONSUMPTION_API_KEY` | entrega | Chave `consumption_delivery` |
| `DELIVERY_TOKENS` | entrega | Tokens `EFDEL...` csv (1 uso cada) |
| `DELIVERY_ACTION` | entrega | `preview` \| `complete` \| `both` |
| `ESTABLISHMENT_ID` | consumo app | UUID estabelecimento |
| `PRODUCT_ID` | consumo app | UUID produto |
| `PRODUCT_QTY` | consumo app | Quantidade (default 1) |

### Exemplo PowerShell

```powershell
$env:SUPABASE_URL = "https://xxx.supabase.co"
$env:SUPABASE_ANON_KEY = "eyJ..."
$env:EVENT_ID = "uuid-evento"
$env:WRISTBAND_ID = "uuid-lote"
$env:AUTH_TOKENS = "jwt1,jwt2,jwt3"
$env:STRESS_VUS = "20"
$env:STRESS_DURATION = "2m"
```

---

## Cenários — Checkout (ingresso MP)

### 1. Disponibilidade (leitura)

```powershell
k6 run load-tests/availability.js
```

Meta: p95 < 500 ms em `get_event_ticket_availability`.

### 2. Reserva concorrente

```powershell
k6 run load-tests/checkout-reserve-stress.js
```

Simula N usuários reservando ao mesmo tempo. Conflitos 409 são esperados; overselling **não**.

### 3. Integridade pós-teste

```powershell
k6 run load-tests/verify-integrity.js
```

**Deve retornar `ok: true`** após testes de reserva.

---

## Cenários — Portaria (validate-ticket)

**Pré-seed:** ingressos pagos + chave em `/manager/validation-keys` (`entry_exit`).

```powershell
$env:VALIDATION_API_KEY = "AB12CD34"
$env:WRISTBAND_CODES = "uuid-1,uuid-2,EF1.xxx,EF1.yyy"
k6 run load-tests/validate-ticket-stress.js
```

- Use **códigos únicos** no pool para maximizar entradas OK na 1ª passada.
- Reutilizar o mesmo código gera 4xx esperado (ingresso já usado) — válido para testar carga da API.

---

## Cenários — Entrega consumo (EFDEL)

**Pré-seed:** compras no app que geraram `EFDEL.*` + chave `consumption_delivery`.

```powershell
$env:CONSUMPTION_API_KEY = "XY98ZW76"
$env:DELIVERY_TOKENS = "EFDEL.aaa,EFDEL.bbb,EFDEL.ccc"
$env:DELIVERY_ACTION = "both"
k6 run load-tests/consumption-delivery-stress.js
```

> Cada token só completa **uma vez**. Pool de tokens ≥ VUs × iterações esperadas.

---

## Cenários — Ingresso com crédito

```powershell
$env:AUTH_TOKENS = "jwt1,jwt2,..."
k6 run load-tests/credit-spend-ticket-stress.js
```

Clientes precisam de saldo na carteira e evento elegível a crédito.

---

## Cenários — Consumo no app (intent + confirm)

```powershell
$env:ESTABLISHMENT_ID = "uuid-estabelecimento"
$env:PRODUCT_ID = "uuid-produto"
$env:AUTH_TOKENS = "jwt1,jwt2,..."
k6 run load-tests/credit-consumption-stress.js
```

Gera pedidos debitados; tokens EFDEL saem no confirm (use para alimentar `DELIVERY_TOKENS`).

---

## Ordem recomendada (dia de teste)

1. `availability.js` — baseline
2. Evento sandbox com estoque conhecido (ex.: 1.000)
3. `checkout-reserve-stress.js` — carga moderada
4. `verify-integrity.js`
5. `credit-spend-ticket-stress.js` (se crédito habilitado)
6. `validate-ticket-stress.js` (após materializar ingressos paid)
7. `credit-consumption-stress.js` → coletar EFDEL → `consumption-delivery-stress.js`
8. `verify-integrity.js` — go/no-go final

Repetir checkout com fila virtual (`checkout_queue_enabled`).

---

## Arquivos

| Arquivo | Endpoint / fluxo |
|---------|------------------|
| `_shared.js` | Helpers (headers, pool JWT, env) |
| `availability.js` | RPC disponibilidade |
| `checkout-reserve-stress.js` | `create-payment-preference` |
| `verify-integrity.js` | RPC integridade |
| `validate-ticket-stress.js` | `validate-ticket` |
| `consumption-delivery-stress.js` | `validate-consumption-delivery` |
| `credit-spend-ticket-stress.js` | `credit-spend` (ingresso) |
| `credit-consumption-stress.js` | intent + confirm consumo |

---

## Referências

- Plano operacional carga: `docs/PLANO_TESTE_CARGA_INGRESSO_VALIDACAO_CONSUMO.md`
- Grande porte: `docs/PLANO_GRANDE_PORTE_INGRESSOS.md`
- Runbook: `docs/RUNBOOK_GRANDE_PORTE.md`
- Dashboard admin: `/admin/settings/checkout-observability`

> **Atenção:** checkout e crédito consomem estoque/saldo real. Use **evento sandbox** e restaure após o teste.
