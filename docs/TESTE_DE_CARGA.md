# Teste de Carga — EventFest

**Documento consolidado:** tudo o que foi passado no chat + plano operacional + scripts k6.  
**Produto:** EventFest  
**Escopo:** compra de ingresso · validação QR na portaria · consumo com crédito  
**Ambiente:** homolog / sandbox (nunca primeiro teste agressivo em produção)  
**Data:** 2026-08-14  

---

## Sumário executivo (o que foi passado no chat)

### Visão geral — 3 frentes

| Frente | O que testa | Ferramenta |
|--------|-------------|------------|
| **Compra ingresso** | MP + crédito, fila, estoque | k6 pronto (`load-tests/`) |
| **Validação QR portaria** | Entrada/saída `/validator` | k6 `validate-ticket-stress.js` + celular |
| **Consumo** | App, PDV, entrega `EFDEL` | k6 consumo + entrega + PDV manual |

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  COMPRA         │     │  PORTARIA        │     │  CONSUMO            │
│  MP + crédito   │ ──► │  validate-ticket │     │  app + PDV + EFDEL  │
│  fila virtual   │     │  /validator      │     │  validate-delivery  │
└────────┬────────┘     └────────┬─────────┘     └──────────┬──────────┘
         │                       │                          │
         ▼                       ▼                          ▼
  batch_inventory          validation_logs            credit_spend_orders
  receivables              wristband_movements        credit_consumption_intents
  payment_webhook_jobs     wristband_analytics        credit_ledger
```

| Frente | k6? | Auth principal |
|--------|:---:|----------------|
| Compra MP (reserva) | **Sim** | JWT cliente |
| Compra crédito ingresso | **Sim** | JWT cliente (`AUTH_TOKENS` pool) |
| Validação entrada QR | **Sim** | Anon + `x-api-key` |
| Consumo app + entrega | **Sim** | JWT cliente / anon + chave |
| PDV consumo | Manual | JWT operador PDV |

---

## 1. O que preparar antes do dia

### 1.1 Ferramentas

| Item | Como instalar | Para quê |
|------|---------------|----------|
| **k6** | `choco install k6` (Windows) | Scripts em `load-tests/` |
| **curl** ou Postman | Já no Windows 10+ | Smoke manual |
| **2+ celulares** | — | `/validator` + `/wallet` |
| Planilha | — | Anotar p50 / p95 / erros |

### 1.2 Credenciais (PowerShell)

```powershell
$env:SUPABASE_URL = "https://SEU_PROJETO.supabase.co"
$env:SUPABASE_ANON_KEY = "eyJ..."
$env:AUTH_TOKEN = "eyJ..."          # 1 JWT — limitado
$env:AUTH_TOKENS = "jwt1,jwt2,jwt3" # pool — recomendado
$env:EVENT_ID = "uuid-do-evento"
$env:WRISTBAND_ID = "uuid-do-lote"
$env:UNIT_PRICE = "50"
$env:STRESS_VUS = "10"
$env:STRESS_DURATION = "1m"
$env:VALIDATION_API_KEY = "AB12CD34"       # portaria entry_exit
$env:CONSUMPTION_API_KEY = "XY98ZW76"      # consumo delivery
$env:WRISTBAND_CODES = "uuid1,uuid2,EF1.xxx"
$env:DELIVERY_TOKENS = "EFDEL.aaa,EFDEL.bbb"
$env:ESTABLISHMENT_ID = "uuid-bar"
$env:PRODUCT_ID = "uuid-produto"
```

Salve os valores reais em `load-tests/env.local.ps1` (arquivo local, fora do git). Carregue com `. .\load-tests\env.local.ps1` antes do k6.

| Variável | Descrição |
|----------|-----------|
| `SERVICE_ROLE_KEY` | Só eng. — worker webhook / seed (nunca commitar) |
| `VALIDATION_TYPE` | `entry` \| `exit` \| `auto` |
| `DELIVERY_ACTION` | `preview` \| `complete` \| `both` |
| `PRODUCT_QTY` | Qtd no consumo app (default 1) |
| `SLEEP_SECONDS` | Pausa entre iterações k6 |

> **Crítico:** um único `AUTH_TOKEN` esbarra no rate limit (~30 checkout/min por usuário). Use **pool `AUTH_TOKENS`** ou eleve `checkout_rate_limit_per_minute` no evento sandbox.

### 1.3 Contas mínimas

| Papel | Qtd | Uso |
|-------|:---:|-----|
| Admin master | 1 | Dashboard observabilidade |
| Gestor | 1 | Evento, chaves, estabelecimento |
| Clientes compradores | **20–100** | Pool JWT |
| Clientes com crédito | **10–50** | Ingresso/consumo carteira |
| Operador PDV | 1–2 | `/manager/credit/pdv` |
| Validador portaria | 1+ celular | `/validator` (sem login) |

### 1.4 Fixtures (seed sandbox)

| # | Fixture | Como | Qtd sugerida |
|---|---------|------|--------------|
| F1 | Evento grande porte (counter) | Editar evento | 1 |
| F2 | Lote com estoque fixo | 1.000 → 5.000 | 1+ |
| F3 | `% applied_percentage` anotada | Campo evento | — |
| F4 | Fila virtual (2ª rodada) | `checkout_queue_enabled=true` | — |
| F5 | Ingressos **já pagos** | Compras sandbox ou batch | ≥ VUs portaria |
| F6 | QR dinâmicos `EF1.*` | `/tickets` → issue token | Pool |
| F7 | Chave `entry_exit` | `/manager/validation-keys` | 1–3 |
| F8 | Chave `consumption_delivery` | Mesma tela | 1 |
| F9 | Estabelecimento + produtos | `/manager/credit/establishments` | 1 bar + 3 produtos |
| F10 | Saldo crédito clientes | Recarga | R$ 100–500 |
| F11 | Evento aceita crédito | Flag + plano híbrido | — |
| F12 | Conta recebimento gestor | MP ou banco | — |

### 1.5 Configuração do evento piloto

| Campo | Valor teste | Motivo |
|-------|-------------|--------|
| `inventory_mode` | `counter` | Grande porte |
| Estoque total | 1.000 → 5.000 | Integridade conhecida |
| `checkout_queue_enabled` | false → true | Isolar fila |
| `checkout_rate_limit_per_minute` | 120+ (sandbox) | Evitar falso negativo |
| `checkout_async_webhook` | true | Como produção |
| Preço lote | R$ 10–50 | Barato no sandbox MP |

---

## 2. Monitoramento

### Dashboards

| Onde | O que olhar |
|------|-------------|
| `/admin/settings/checkout-observability` | Jobs webhook, pendentes, fila, conflitos |
| Supabase → Edge Functions logs | `create-payment-preference`, `validate-ticket`, webhook |
| Supabase Database / CPU | Picos de conexão |

### Alertas

| Métrica | Amarelo | Vermelho | Ação |
|---------|---------|----------|------|
| Webhook jobs pendentes | ≥ 25 | ≥ 100 | `process-payment-webhook-jobs` |
| Checkouts pending | ≥ 100 | ≥ 500 | Pausar evento |
| Fila aguardando | ≥ 500 | ≥ 5.000 | `admit_event_checkout_queue_batch` |
| Integridade estoque | — | qualquer falha | **STOP** |
| p95 validate-ticket | > 2 s | > 5 s | Reduzir VUs |
| Erros 429 checkout | > 5% | > 20% | Mais JWTs / subir rate limit |

### Go / No-go

**GO** se:
- [ ] `verify_event_inventory_integrity` → `ok: true`
- [ ] Zero overselling (`sold + reserved <= total`)
- [ ] p95 disponibilidade < 500 ms
- [ ] p95 reserva checkout ≤ 5 s (homolog)
- [ ] 2ª scan portaria = bloqueio esperado
- [ ] Consumo: saldo + ledger coerentes

**NO-GO** se:
- [ ] Integridade falhou
- [ ] Overselling
- [ ] Webhook parado > 10 min com centenas pending
- [ ] p95 portaria > 5 s sustentado

---

## 3. Roteiro do dia

### Fase 0 — Setup (30–45 min)

1. [ ] Confirmar ambiente (não prod)
2. [ ] Evento piloto + estoque
3. [ ] Chaves validação (portaria + consumo)
4. [ ] Pool de usuários + JWTs
5. [ ] Recarga crédito
6. [ ] Baseline: `k6 run load-tests/availability.js`
7. [ ] Print dashboard (estado inicial)

### Fase 1 — Compra ingresso MP (45–60 min)

| Rodada | VUs | Duração | Script |
|--------|-----|---------|--------|
| R1 leve | 10 | 1m | `checkout-reserve-stress.js` |
| R2 média | 30 | 2m | idem |
| R3 pico | 50 | 2m | `STRESS_VUS=50` |
| R4 fila | 50 | 2m | Com fila virtual ligada |

```powershell
cd c:\V3\tipoevento
k6 run load-tests/availability.js
k6 run load-tests/checkout-reserve-stress.js
k6 run load-tests/verify-integrity.js
```

Após cada rodada: integridade + anotar req/s, p95, % 409, % 429 + pausa 5 min.

### Fase 2 — Ingresso com crédito (30 min)

```powershell
$env:AUTH_TOKENS = "jwt1,jwt2,..."
k6 run load-tests/credit-spend-ticket-stress.js
```

Ou curl:

```http
POST {SUPABASE_URL}/functions/v1/credit-spend
Authorization: Bearer {JWT_CLIENTE}
x-idempotency-key: load-{uuid}

{
  "eventId": "...",
  "purchaseItems": [{ "ticketTypeId": "...", "quantity": 1, "price": 50 }]
}
```

Critérios: sem double-spend; saldo insuficiente = erro claro; retry mesma key = duplicate.

### Fase 3 — Portaria QR (45–60 min)

- UI: `/validator` ou `/validador` (pública)
- API: `POST /functions/v1/validate-ticket` + anon + `x-api-key`

```powershell
$env:VALIDATION_API_KEY = "SUA_CHAVE"
$env:WRISTBAND_CODES = "uuid1,uuid2,EF1.xxx"
k6 run load-tests/validate-ticket-stress.js
```

| Rodada | Meta p95 |
|--------|----------|
| Manual 50 scans | < 1 s |
| Paralelo k6 | < 2 s |
| Replay mesmo QR | 2ª = bloqueio |
| Saída (`exit`) | Alternância OK |

### Fase 4 — Consumo (45–60 min)

**4A — App (intent + confirm):**

```powershell
$env:ESTABLISHMENT_ID = "uuid-bar"
$env:PRODUCT_ID = "uuid-produto"
$env:AUTH_TOKENS = "jwt1,jwt2"
k6 run load-tests/credit-consumption-stress.js
```

**4B — Entrega EFDEL:**

```powershell
$env:CONSUMPTION_API_KEY = "SUA_CHAVE"
$env:DELIVERY_TOKENS = "EFDEL.aaa,EFDEL.bbb"
$env:DELIVERY_ACTION = "both"
k6 run load-tests/consumption-delivery-stress.js
```

> Cada EFDEL completa **uma vez**. Pool ≥ VUs × iterações.

**4C — PDV:** `/manager/credit/pdv` — 2 operadores × 30 débitos; meta p95 < 3 s.

### Fase 5 — Cenário “dia D” (30–45 min)

```
T+0   Vendas (k6 checkout 50 VUs, 3 min)
T+10  Webhook drenando — dashboard
T+20  Portaria (validate-ticket ~30 req/s, 5 min)
T+25  Consumo bar (10 app + 5 EFDEL/min)
T+30  verify-integrity + saldos
```

---

## 4. Scripts k6 (criados / existentes)

Pasta: `load-tests/`

| Arquivo | Fluxo |
|---------|-------|
| `_shared.js` | Helpers (headers, pool JWT, env) |
| `availability.js` | Leitura estoque |
| `checkout-reserve-stress.js` | Reserva MP |
| `verify-integrity.js` | Go/no-go estoque |
| `validate-ticket-stress.js` | Portaria |
| `consumption-delivery-stress.js` | Entrega EFDEL |
| `credit-spend-ticket-stress.js` | Ingresso crédito |
| `credit-consumption-stress.js` | Consumo app |

Detalhes de env: `load-tests/README.md`.

### Ordem recomendada dos scripts

1. `availability.js`
2. `checkout-reserve-stress.js`
3. `verify-integrity.js`
4. `credit-spend-ticket-stress.js`
5. `validate-ticket-stress.js`
6. `credit-consumption-stress.js` → coletar EFDEL
7. `consumption-delivery-stress.js`
8. `verify-integrity.js` final

---

## 5. Pool de JWTs (evitar rate limit)

**Opção A:** criar 20 usuários → login → copiar `access_token` → `AUTH_TOKENS=jwt1,jwt2,...`

**Opção B (sandbox):**

```sql
UPDATE events
SET checkout_rate_limit_per_minute = 500
WHERE id = 'EVENT_UUID';
```

Use A + B para carga mais realista.

---

## 6. Emergência — pausar tudo

1. Desativar evento (`is_active = false`)
2. Confirmar novos checkouts falham
3. **Não** apagar `receivables` / `batch_inventory`
4. SQL:

```sql
SELECT public.verify_event_inventory_integrity('EVENT_UUID'::uuid);
SELECT public.expire_stale_ticket_checkout_reservations(1000);
```

5. Worker webhook:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/process-payment-webhook-jobs" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 25}'
```

---

## 7. Planilha de registro

| Hora | Fase | VUs / req/s | p50 | p95 | Erros % | Integridade | Observação |
|------|------|-------------|-----|-----|---------|-------------|------------|
| | availability | | | | | | |
| | checkout R1 | | | | | | |
| | checkout R2 | | | | | | |
| | crédito ingresso | | | | | | |
| | validate-ticket | | | | | | |
| | consumo app | | | | | | |
| | EFDEL delivery | | | | | | |
| | PDV | | | | | | |
| | combinado | | | | | | |

---

## 8. Equipe mínima

| Pessoa | Responsabilidade |
|--------|------------------|
| Driver k6 | Scripts + métricas |
| Observador admin | Dashboard + logs Supabase |
| Portaria | 1–2 celulares `/validator` |
| Consumo | PDV + balcão EFDEL |
| Decisor | Go/no-go, pausar evento |

---

## 9. Checklist — o que levar no dia

- [ ] Notebook com k6 + env vars
- [ ] Lista de JWTs (20+)
- [ ] UUID evento + lote + estoque anotado
- [ ] Chaves validação (portaria + consumo)
- [ ] Pool QR ingresso (paid) e EFDEL
- [ ] 2+ celulares
- [ ] Acesso admin observabilidade
- [ ] Plano B: pausar + SQL integridade
- [ ] Sandbox MP (se pagamento real)
- [ ] Planilha de resultados

---

## 10. Dicas importantes (resumo do chat)

1. **`AUTH_TOKENS`** — vários JWTs separados por vírgula.
2. **Portaria** — códigos únicos maximizam sucesso; reutilizar gera 4xx esperado.
3. **EFDEL** — um uso por token; gere pool com `credit-consumption-stress` antes da entrega.
4. Comece leve (**10 VUs**), suba gradualmente.
5. **Nunca** pule `verify-integrity` entre rodadas.
6. Checkout e crédito consomem estoque/saldo real — use **sandbox**.

---

## 11. Documentos relacionados

| Documento | Uso |
|-----------|-----|
| `load-tests/README.md` | Comandos k6 detalhados |
| `docs/PLANO_TESTE_CARGA_INGRESSO_VALIDACAO_CONSUMO.md` | Plano técnico (versão anterior) |
| `docs/RUNBOOK_GRANDE_PORTE.md` | Incidentes webhook/fila |
| `docs/PLANO_GRANDE_PORTE_INGRESSOS.md` | SLOs e arquitetura |
| `docs/PLANO_TESTE_COMPRA_INGRESSO_RELATORIOS.md` | Financeiro pós-carga |
| `docs/PLANO_TESTE_CONSUMO_CREDITO_PRODUTO.md` | Consumo pós-carga |
| `docs/VALIDADOR_INSTALAR_CELULAR.md` | PWA portaria |

---

**Fim do documento Teste de Carga.** Este é o guia único para executar o teste de ponta a ponta.
