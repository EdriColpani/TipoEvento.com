# Plano de teste de carga — Ingressos · Validação QR · Consumo

**Produto:** EventFest  
**Objetivo:** simular pico realista de **compra de ingresso**, **validação na portaria** e **consumo com crédito**; medir latência, integridade e limites do sistema.  
**Ambiente recomendado:** **homolog/sandbox** (nunca primeiro teste agressivo em produção).  
**Última atualização:** 2026-08-14  

---

## 0. Visão geral — três frentes

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

| Frente | Já tem k6? | Auth principal |
|--------|:----------:|----------------|
| Compra MP (reserva) | **Sim** (`load-tests/`) | JWT cliente |
| Compra crédito ingresso | Não (script manual/curl) | JWT cliente |
| Validação entrada QR | **Não** (curl/k6 a criar) | Anon + `x-api-key` |
| Consumo app + entrega | **Não** (curl/k6 a criar) | JWT cliente / anon + chave |
| PDV consumo | Não | JWT operador PDV |

---

## 1. O que você precisa ter pronto (checklist geral)

### 1.1 Ferramentas na máquina do tester

| Item | Como instalar | Para quê |
|------|---------------|----------|
| **k6** | `choco install k6` (Windows) | Scripts em `load-tests/` |
| **curl** ou **Postman/Insomnia** | Já no Windows 10+ | Validação/consumo sem k6 |
| **Node 18+** (opcional) | Se quiser script custom | Pool de JWTs, seed |
| **2+ celulares** | — | Validador real `/validator` + cliente `/wallet` |
| **Planilha ou Notion** | — | Folha de resultados (VUs, p95, erros) |

### 1.2 Credenciais e variáveis de ambiente

Exportar no PowerShell **antes** de rodar k6:

```powershell
$env:SUPABASE_URL = "https://SEU_PROJETO.supabase.co"
$env:SUPABASE_ANON_KEY = "eyJ..."
$env:AUTH_TOKEN = "eyJ..."          # JWT de UM usuário (limitado — ver pool abaixo)
$env:EVENT_ID = "uuid-do-evento"
$env:WRISTBAND_ID = "uuid-do-lote"
$env:UNIT_PRICE = "50"
$env:STRESS_VUS = "30"
$env:STRESS_DURATION = "2m"
```

| Variável extra (validação/consumo) | Descrição |
|-----------------------------------|-----------|
| `VALIDATION_API_KEY` | Chave 8 chars `entry_exit` (portaria) |
| `CONSUMPTION_API_KEY` | Chave `consumption_delivery` (balcão) |
| `SERVICE_ROLE_KEY` | **Só Admin eng.** — worker webhook, seed (nunca commitar) |
| Pool `AUTH_TOKENS` | Lista de JWTs de N usuários de teste |

> **Crítico:** um único `AUTH_TOKEN` esbarra no **rate limit por usuário** (`checkout_rate_limit_per_minute`, default 30/min). Para carga real, use **pool de usuários** ou eleve o limite no evento sandbox.

### 1.3 Contas de teste (mínimo sugerido)

| Papel | Qtd mín. | Uso |
|-------|:--------:|-----|
| Admin master | 1 | Dashboard observabilidade, emergência |
| Gestor (empresa piloto) | 1 | Evento, chaves, estabelecimento |
| Clientes compradores | **20–100** | Pool JWT para k6 |
| Clientes com crédito | **10–50** | Compra ingresso/consumo com carteira |
| Operador PDV | 1–2 | `/manager/credit/pdv` |
| Validador portaria | 1+ celular | `/validator` (sem login) |

### 1.4 Dados / fixtures no banco (seed)

Executar **antes** do teste, em ambiente sandbox:

| # | Fixture | Como criar | Quantidade sugerida |
|---|---------|------------|---------------------|
| F1 | Evento piloto **grande porte** | Gestor → editar evento → modo counter + estoque conhecido | 1 evento |
| F2 | Lote pago com estoque fixo | Ex.: **1.000** ou **5.000** unidades | 1+ lotes |
| F3 | `% applied_percentage` anotada | Campo do evento | — |
| F4 | Fila virtual (opcional) | `checkout_queue_enabled=true` se testar waiting room | — |
| F5 | Ingressos **já pagos** para portaria | Compras reais sandbox **ou** `create-wristbands-batch` + status paid | **≥ nº de VUs** da portaria |
| F6 | QR dinâmicos `EF1.*` | Cliente abre `/tickets` → emite token (`issue-entry-token`) | Pool de códigos |
| F7 | Chave validação **entrada/saída** | `/manager/validation-keys` → propósito `entry_exit` | 1–3 chaves |
| F8 | Chave validação **consumo/entrega** | Mesma tela → `consumption_delivery` | 1 chave |
| F9 | Estabelecimento + produtos | `/manager/credit/establishments` | 1 bar + 3 produtos |
| F10 | Saldo crédito nos clientes | Recarga sandbox ou ajuste homolog | R$ 100–500 cada |
| F11 | Evento aceita crédito | Flag no evento + plano híbrido | — |
| F12 | Conta recebimento gestor | MP ou banco (para não bloquear fluxos) | — |

### 1.5 Configuração do evento piloto (recomendado)

| Campo | Valor teste | Motivo |
|-------|-------------|--------|
| `inventory_mode` | `counter` | Estoque contador — padrão grande porte |
| Estoque total | 1.000 (1ª rodada) → 5.000 (2ª) | Conhecido para integridade |
| `checkout_queue_enabled` | false → true (2ª rodada) | Isolar fila |
| `checkout_rate_limit_per_minute` | 120+ (sandbox) | Evitar falso negativo por 1 JWT |
| `checkout_async_webhook` | true | Comportamento produção |
| Preço lote | R$ 10–50 | Barato para muitas compras sandbox MP |

---

## 2. Monitoramento durante o teste

### 2.1 Dashboards (obrigatório)

| Onde | URL / caminho | O que olhar |
|------|---------------|-------------|
| Checkout observabilidade | `/admin/settings/checkout-observability` | Jobs webhook, pendentes, fila, conflitos |
| Supabase Dashboard | Logs → Edge Functions | `create-payment-preference`, `validate-ticket`, `mercadopago-webhook` |
| Supabase Database | Advisors / CPU | Picos de conexão |

### 2.2 Alertas (amarelo / vermelho)

| Métrica | Amarelo | Vermelho | Ação |
|---------|---------|----------|------|
| Webhook jobs pendentes | ≥ 25 | ≥ 100 | Invocar `process-payment-webhook-jobs` |
| Checkouts pending | ≥ 100 | ≥ 500 | Pausar evento |
| Fila aguardando | ≥ 500 | ≥ 5.000 | `admit_event_checkout_queue_batch` |
| Integridade estoque | — | qualquer falha | **STOP** — pausar vendas |
| p95 validate-ticket | > 2 s | > 5 s | Reduzir VUs portaria |
| Erros 429 checkout | > 5% | > 20% | Mais JWTs ou subir rate limit |

### 2.3 Go / No-go (fim de cada rodada)

**GO** se:
- [ ] `verify_event_inventory_integrity` → `ok: true`
- [ ] Zero overselling (`sold + reserved <= total`)
- [ ] p95 disponibilidade < 500 ms (leitura)
- [ ] p95 reserva checkout dentro do SLO (≤ 5 s homolog)
- [ ] Validação: 0 entradas duplicadas indevidas (2ª scan = erro esperado)
- [ ] Consumo: saldo cliente + ledger coerentes

**NO-GO** se:
- [ ] Integridade falhou
- [ ] Ingresso vendido além do estoque
- [ ] Webhook parado > 10 min com centenas de pending
- [ ] Latência portaria impede operação real (> 5 s p95 sustentado)

---

## 3. Roteiro do dia — ordem sugerida

### Fase 0 — Setup (30–45 min)

1. [ ] Confirmar ambiente (URL, não prod acidental)
2. [ ] Criar/atualizar evento piloto + estoque
3. [ ] Gerar chaves validação (portaria + consumo)
4. [ ] Criar pool de usuários + exportar JWTs
5. [ ] Recarregar crédito nos clientes de consumo
6. [ ] Baseline: `k6 run load-tests/availability.js`
7. [ ] Print dashboard observabilidade (estado inicial)

### Fase 1 — Compra ingresso MP (45–60 min)

| Rodada | VUs | Duração | Script |
|--------|-----|---------|--------|
| R1 leve | 10 | 1m | `checkout-reserve-stress.js` |
| R2 média | 30 | 2m | idem |
| R3 pico | 50 | 2m | `STRESS_VUS=50` |
| R4 fila | 50 | 2m | Com `checkout_queue_enabled=true` |

Comandos:

```powershell
cd c:\V3\tipoevento
k6 run load-tests/availability.js
k6 run load-tests/checkout-reserve-stress.js
k6 run load-tests/verify-integrity.js
```

Após cada rodada:
- [ ] `verify-integrity.js`
- [ ] Anotar: req/s, p95, % 409 (esperado), % 429 (rate limit)
- [ ] Pausa 5 min entre rodadas (webhook drenar)

**Opcional MP real:** completar pagamento sandbox MP para materializar ingressos — necessário antes da Fase 2 se não usar seed paid.

### Fase 2 — Compra ingresso com crédito (30 min)

Manual ou curl repetido (não há k6 pronto):

```http
POST {SUPABASE_URL}/functions/v1/credit-spend
Authorization: Bearer {JWT_CLIENTE}
x-idempotency-key: load-{uuid}
Content-Type: application/json

{
  "eventId": "...",
  "purchaseItems": [{ "ticketTypeId": "...", "quantity": 1, "price": 50 }]
}
```

| Caso | VUs simulados | Critério |
|------|---------------|----------|
| 10 clientes paralelos | 10 curls simultâneos | Sem double-spend |
| Saldo insuficiente | 1 cliente | 400 claro |
| Idempotency retry | Mesma key 2× | 2ª = duplicate, 1 débito |

Conferir: Financeiro Split=Crédito, Consumos, estoque −1.

### Fase 3 — Validação QR na portaria (45–60 min)

**Rota UI:** `/validator` ou `/validador` (pública, sem login).

**API:**

```http
POST {SUPABASE_URL}/functions/v1/validate-ticket
Authorization: Bearer {ANON_KEY}
apikey: {ANON_KEY}
x-api-key: {VALIDATION_API_KEY_8_CHARS}
Content-Type: application/json

{ "wristband_code": "EF1.... ou UUID ou BASE-001", "validation_type": "entry" }
```

| Rodada | Simulação | Meta p95 |
|--------|-----------|----------|
| P1 manual | 2 celulares, 50 scans sequenciais | < 1 s |
| P2 paralelo | k6 ou 5 terminais × 20 req/s | < 2 s |
| P3 replay | Mesmo QR 2× seguidas | 2ª = bloqueio (used/replay) |
| P4 saída | `validation_type: "exit"` | Alternância entry/exit |

**Pool de códigos:** pré-gerar 100–500 ingressos paid + tokens `EF1.*` (cada cliente em `/tickets`).

Métricas:
- Taxa sucesso 1ª entrada
- Taxa erro esperado na 2ª entrada
- Inserts/min em `validation_logs`
- CPU edge `validate-ticket`

**Celular real:** instalar PWA / abrir Chrome → `/validator` → testar câmera + digitação manual.

### Fase 4 — Consumo com crédito (45–60 min)

#### 4A — Cliente compra no app (cardápio)

Fluxo:
1. `create-credit-consumption-intent`
2. `confirm-credit-consumption-intent` (+ `x-idempotency-key`)
3. QR entrega `EFDEL.*` gerado

Carga: 10–30 clientes paralelos comprando 1 produto.

Conferir: saldo −, estoque produto −, `credit_spend_orders`, intent `completed` após entrega.

#### 4B — Entrega no balcão (EFDEL)

**Via validador externo (mesmo padrão portaria):**

```http
POST {SUPABASE_URL}/functions/v1/validate-consumption-delivery
Authorization: Bearer {ANON_KEY}
apikey: {ANON_KEY}
x-api-key: {CONSUMPTION_API_KEY}
Content-Type: application/json

{ "action": "preview", "delivery_token": "EFDEL...." }
{ "action": "complete", "delivery_token": "EFDEL...." }
```

| Rodada | Carga | Critério |
|--------|-------|----------|
| 20 entregas sequenciais | 1 operador | preview + complete OK |
| 10 entregas paralelas | k6/curl | Sem double complete |
| Token já usado | replay | Erro claro |

#### 4C — PDV presencial

Rota: `/manager/credit/pdv` (operador logado).

Sequência:
1. Cliente: `issue-wallet-qr-token` (JWT)
2. Operador: `credit-spend-pdv` com wallet token

Carga: 2 operadores × 30 débitos = 60 transações. Meta: p95 < 3 s.

### Fase 5 — Cenário combinado “dia D” (30–45 min)

Simular pico real **sequencial** (não tudo junto na 1ª vez):

```
T+0   Abertura vendas (k6 checkout 50 VUs, 3 min)
T+10  Webhook drenando — monitorar dashboard
T+20  Portaria abre (validate-ticket 30 req/s, 5 min)
T+25  Consumo bar (10 clientes app + 5 entregas EFDEL/min)
T+30  verify-integrity + conferência saldos
```

---

## 4. Scripts k6 existentes (referência)

| Arquivo | Cenário | Env vars |
|---------|---------|----------|
| `load-tests/availability.js` | Leitura estoque | URL, ANON, EVENT_ID |
| `load-tests/checkout-reserve-stress.js` | Reserva concorrente MP | + AUTH_TOKEN, WRISTBAND_ID |
| `load-tests/verify-integrity.js` | Go/no-go estoque | + EVENT_ID |

Leia: `load-tests/README.md`, `docs/RUNBOOK_GRANDE_PORTE.md`.

### Scripts a criar (se sobrar tempo hoje)

| Script | Endpoint | Status |
|--------|----------|:------:|
| `validate-ticket-stress.js` | `validate-ticket` | **Implementado** |
| `consumption-delivery-stress.js` | `validate-consumption-delivery` | **Implementado** |
| `credit-spend-ticket-stress.js` | `credit-spend` | **Implementado** |
| `credit-consumption-stress.js` | intent + confirm consumo | **Implementado** |

Ver comandos em `load-tests/README.md`.

---

## 5. Pool de JWTs (evitar rate limit)

### Opção A — PowerShell rápido

1. Criar 20 usuários `@loadtest.eventfest.local` via `/register`.
2. Login de cada um → copiar `access_token` do localStorage.
3. Arquivo `load-tests/tokens.txt` (uma linha por JWT).
4. Alterar script k6 para ler token por VU: `tokens[__VU % tokens.length]`.

### Opção B — Elevar limite no evento (sandbox)

```sql
UPDATE events
SET checkout_rate_limit_per_minute = 500
WHERE id = 'EVENT_UUID';
```

Use **A + B** para teste mais realista.

---

## 6. Emergência — pausar tudo

1. Gestor/Admin: **desativar evento** (`is_active = false`)
2. Confirmar novos checkouts falham
3. Não apagar `receivables` / `batch_inventory` manualmente
4. Rodar:

```sql
SELECT public.verify_event_inventory_integrity('EVENT_UUID'::uuid);
SELECT public.expire_stale_ticket_checkout_reservations(1000);
```

5. Worker webhook (service role):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/process-payment-webhook-jobs" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 25}'
```

---

## 7. Planilha de registro (copiar)

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

## 8. Equipe mínima amanhã

| Pessoa | Responsabilidade |
|--------|------------------|
| **Driver k6** | Roda scripts, anota métricas |
| **Observador admin** | Dashboard checkout + Supabase logs |
| **Portaria** | 1–2 celulares `/validator` |
| **Consumo** | Operador PDV + balcão EFDEL |
| **Decisor** | Go/no-go, pausar evento |

---

## 9. Relação com outros documentos

| Documento | Uso |
|-----------|-----|
| `load-tests/README.md` | Comandos k6 checkout |
| `docs/RUNBOOK_GRANDE_PORTE.md` | Incidentes webhook/fila |
| `docs/PLANO_GRANDE_PORTE_INGRESSOS.md` | SLOs e arquitetura |
| `docs/PLANO_TESTE_COMPRA_INGRESSO_RELATORIOS.md` | Conferência financeira pós-carga |
| `docs/PLANO_TESTE_CONSUMO_CREDITO_PRODUTO.md` | Conferência consumo pós-carga |
| `docs/VALIDADOR_INSTALAR_CELULAR.md` | PWA portaria no celular |

---

## 10. Resumo — o que levar amanhã

- [ ] Notebook com k6 + env vars exportadas
- [ ] Lista de JWTs (20+ usuários)
- [ ] UUID evento + lote + estoque anotado
- [ ] Chaves validação (portaria + consumo) anotadas
- [ ] Pool de códigos QR ingresso (paid) e EFDEL (pós-compra)
- [ ] 2+ celulares (validador + cliente)
- [ ] Acesso admin ao dashboard observabilidade
- [ ] Plano B: pausar evento + SQL integridade
- [ ] Ambiente **sandbox** MP (se testar pagamento real)
- [ ] Planilha de resultados

**Fim.** Comece leve (10 VUs), suba gradualmente, e **nunca** pule `verify-integrity` entre rodadas.
