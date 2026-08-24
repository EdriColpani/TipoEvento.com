# Handoff — Repasse D+1 vs liquidação MP (PIX / débito / crédito)

> **Status:** **Fases 0–5 concluídas** (2026-08-24).  
> **Criado:** 2026-08-21  
> **Atualizado:** 2026-08-24 — Fase 5 (auditoria de relatórios + cron de liberação).  
> **Contexto:** dono sem capital de giro; D+1 universal em cartão de crédito (~30 dias de liquidação MP) não fecha caixa.

### Decisões fechadas (2026-08-24)

| Tema | Decisão |
|------|---------|
| Data de liberação no cartão | Usar **`money_release_date` do MP** quando vier; se nula/vazia → **D+30** |
| Backfill fila antiga | **Só novos lançamentos** (sistema ainda em teste) |
| Autorização | Começar **Fase 0 + Fase 1**; ao fim de todas as fases, revisar **todos os relatórios** afetados |

---

## 0. Regra oficial v0.2 (texto do dono — aprovado)

### Resumo geral

1. **Identificar todas as transações no Mercado Pago** no retorno (webhook/API): tipo **cartão de crédito**, **PIX** ou **cartão de débito**, e **gravar essa informação no banco**.
2. **Recarga de crédito EventFest com cartão de crédito:**
   - o **crédito é liberado ao cliente já** (pode usar na hora);
   - o sistema **obrigatoriamente** gera lançamento de **D+30** para pagamento ao gestor (não D+1).
3. **Compra de ingresso (ou consumo) usando crédito EventFest:**
   - o sistema identifica **como aquele saldo foi adquirido**;
   - se a recarga foi **cartão de crédito** → lançamento ao gestor **D+30**;
   - se a recarga foi **débito** ou **PIX** → lançamento ao gestor **D+1**.

### Decisão explícita (clareza de produto)

| Quem | Cartão de crédito | PIX / débito |
|------|-------------------|--------------|
| **Cliente (carteira)** | Saldo **liberado na hora** | Saldo liberado na hora |
| **Gestor (repasse)** | Fila **D+30** | Fila **D+1** |
| **Ingresso/consumo** | Pode emitir/confirmar na aprovação | Idem |

> **Não** travar o uso do crédito pelo cliente por 30 dias.  
> O que atrasa é **somente o repasse ao gestor**.

---

## 1. Problema em uma frase

O sistema trata **pagamento aprovado** quase como **dinheiro já disponível na EventFest**.  
No **cartão de crédito**, isso é falso: aprovado ≠ liberado para saque (~D+14/D+30 conforme conta MP).

**Sem capital de giro, não se pode pagar gestor em D+1 no crédito.**

---

## 2. Princípio de correção

| Conceito | Significado |
|----------|-------------|
| **Venda / crédito confirmado** | Cliente pagou → saldo na carteira **já liberado**; ingresso/consumo pode ser válido na aprovação |
| **Repasse liberável** | EventFest já pode pagar o gestor (caixa real / prazo por meio) |

### Regra por meio (compra direta no MP — ingresso sem carteira)

| Meio | Cliente / ingresso | Repasse ao gestor |
|------|--------------------|-------------------|
| **PIX** | Na aprovação | **D+1** |
| **Débito** | Na aprovação | **D+1** |
| **Crédito** | Na aprovação | **D+30** (não D+1) |

*(Implementado na Fase 1: cartão usa `money_release_date` do MP; se nula → D+30. PIX/débito → D+1.)*

---

## 3. Carteira EventFest (funding → gasto)

O risco de caixa da consumação/ingresso pago com carteira está na **origem da recarga**, não no “apertar comprar”.

```
Recarga no cartão  →  cliente usa saldo na hora  →  gestor recebe só em D+30
Recarga PIX/débito →  cliente usa saldo na hora  →  gestor recebe em D+1
```

### Na recarga (top-up MP)

| Meio da recarga | Saldo do cliente | Marca do lote / prazo de repasse |
|-----------------|------------------|----------------------------------|
| Cartão de crédito | Liberado **já** | Lote “lento” → **D+30** |
| PIX ou débito | Liberado **já** | Lote “rápido” → **D+1** |

### No gasto (ingresso ou PDV/consumo com carteira)

1. Identificar **de qual lote de recarga** veio o saldo gasto (recomendado: **FIFO** — consome primeiro o saldo mais antigo / na ordem dos lotes).
2. Gerar lançamento ao gestor com o prazo do lote:
   - lote cartão → **D+30**
   - lote PIX/débito → **D+1**

Se o gasto misturar lotes (ex.: R$ 30 PIX + R$ 70 cartão), o lançamento ao gestor deve **proporcionalizar** ou **partir** em linhas por origem.

---

## 4. O que o Mercado Pago informa (persistir no banco)

No webhook / Payment API:

- `payment_type_id` → `credit_card` / `debit_card` / `bank_transfer` (PIX etc.)
- `payment_method_id` → `pix`, `visa`, `master`, …
- muitas vezes **`money_release_date`** → quando o valor fica disponível no MP

**Obrigatório gravar** tipo/meio em toda cobrança MP (ingresso direto, recarga, etc.) para alimentar as filas D+1 / D+30.

---

## 5. Dois caminhos de dinheiro na EventFest (já existentes)

| Canal | Comportamento | Capital de giro EventFest |
|-------|---------------|---------------------------|
| **`mp_split`** | Líquido no MP do gestor + `marketplace_fee` | Baixo no líquido do ingresso |
| **`manual_d1` / banco** | EventFest cobra → fila TED/PIX ao gestor | **Alto** se pagar crédito em D+1 |

A regra v0.2 (D+1 / D+30 por meio) aplica-se sobretudo ao modo **EventFest cobra e repassa**.  
Onde houver **split no MP do gestor**, o líquido já não passa pelo caixa EventFest da mesma forma.

Chargeback ticket-only: `.cursor/rules/ticket-only-chargeback.mdc`.

---

## 6. Modelo alvo (filas)

- Fila **PIX / débito** → `release_at ≈ paid_at + 1 dia útil` (D+1)
- Fila **cartão de crédito** → `release_at ≈ paid_at + 30 dias` (D+30)

Status sugeridos:  
`pending_retention` → `awaiting_release` → `released` → `paid`

Admin só paga o que estiver `released`.

### Política comercial (sem giro)

1. EventFest cobra + repasse **por meio** (v0.2)  
2. Preferir **split MP do gestor** quando houver OAuth/MP conectado  
3. Evitar “D+1 para tudo” no contrato sem aditivo/comunicação  

---

## 7. Plano de execução (só após autorização)

### Fase 0 — Comunicação
- Textos: “PIX/débito D+1 · cartão D+30”  
- Aditivo/comunicação com gestores se a promessa atual era D+1 universal  

### Fase 1 — Separar por meio (obrigatório)
1. Persistir `payment_type` / `payment_method` (+ `money_release_date` se disponível)  
2. Classificar linhas nos ledgers de ingresso e crédito  
3. Recarga: marcar lote rápido vs lento  
4. Gasto carteira: FIFO / origem do saldo → prazo do lançamento  
5. UI Admin/Gestor: filtros e totais por meio e por prazo  
6. Job: libera D+30 só na data  

### Fase 2 — Fila existente
- Revisar o que já foi liberado/pago em cartão como se fosse D+1  
- Segurar futuros créditos de cartão até D+30  
- Manter PIX/débito no fluxo D+1  

### Fase 3 — Textos / UX
- Substituir “D+1” genérico por prazos por meio  
- Relatórios alinhados às filas  

---

## 8. Cuidados

1. **Chargeback de recarga no cartão** — cliente pode já ter gasto o saldo; risco à parte (pipeline de chargeback de crédito).  
2. **FIFO na carteira** — sem rastreio de lote, o prazo do gestor fica errado.  
3. **`money_release_date` vs D+30** — **decidido:** usar data do MP; se nula → D+30.  
4. **Modo `mp_split`** — não misturar a mesma regra de caixa do modo banco sem revisar o fluxo.  

---

## 9. Assuntos relacionados (mesma conversa / outros tópicos)

| Tema | Resumo | Estado |
|------|--------|--------|
| Checkout Transparente (Brick) | Pagar na EventFest sem login no site MP; **ainda é MP** | Plano 4–7 sem; **não autorizado** |
| Desvincular do MP / Cresol | Brick ≠ sair do MP | Só conversa |
| “Sair sem assinar” contrato | Logout real | Implementado |
| Admin Master pedindo contrato | Gate não aplica a Admin | Implementado |
| Gestor completo vendo “Começar cadastro” | companyId/REST + gate | Corrigido |
| OTP campos pouco visíveis | Bordas brancas | Implementado |

---

## 10. Documentos relacionados

- `docs/PAYMENT_MP_PHASES.md`  
- `docs/HANDOFF_PAGAMENTOS_MP_2026-04-30.md`  
- `docs/PLANO_TESTE_COMPRA_INGRESSO_RELATORIOS.md`  
- `docs/QA_PAYOUT_MP_OR_BANK_D1.md`  
- `.cursor/rules/ticket-only-chargeback.mdc`  

---

## 11. Checklist ao retomar

1. ~~Crédito ao cliente na hora vs travar 30 dias?~~ → **Na hora; repasse D+30/MP** (decidido)  
2. ~~Gasto com carteira herda meio da recarga?~~ → **Sim** (Fases 2–3)  
3. ~~D+30 fixo vs `money_release_date`?~~ → **MP date se vier; senão D+30** (decidido)  
4. ~~Backfill?~~ → **Só novos** (decidido)  
5. Incentivar **mp_split** quando gestor tem MP? (ainda aberto)  
6. ~~Autoriza Fase 0+1?~~ → **Sim — concluída 2026-08-24**  
7. ~~Fases 2–3 (lotes + FIFO)?~~ → **Concluídas 2026-08-24**  
8. ~~Fase 4 (UI)?~~ → **Concluída 2026-08-24**  
9. ~~Auditoria relatórios §13?~~ → **Concluída na Fase 5 (2026-08-24)**

### Entregue na Fase 0+1

| Item | Detalhe |
|------|---------|
| Migration | `20260924120000_settlement_release_by_payment_method.sql` (aplicada no projeto) |
| Colunas | `receivables`, `credit_topup_orders`, `manager_ticket_settlement_ledger` (+ helpers SQL) |
| Edge | `mercadopago-webhook` + `check-payment-status` gravam meio/`money_release_date` |
| Ingresso (`manual_d1`) | `create_ticket_settlement_from_receivable` → PIX/débito **D+1**; crédito **MP date ou D+30** |
| Smoke SQL | Normalização + `compute_ticket_settlement_release_at` validados |

### Entregue na Fase 2+3

| Item | Detalhe |
|------|---------|
| Migration | `20260924130000_credit_wallet_funding_lots_fifo.sql` |
| Lotes | `credit_wallet_funding_lots` (1 por top-up pago) |
| FIFO | `credit_spend_funding_allocations` + `allocate_credit_spend_from_lots` |
| Recarga | `credit_topup_settle` grava meio + cria lote na mesma txn; webhook passa funding |
| Gasto | trigger `credit_settlement_from_split` parte splits mistos e seta `release_at` por origem |
| Rollback | `rollback_credit_spend` devolve remaining nos lotes |
| Fallback | saldo sem lote → `other` (D+1), sem travar testes |

### Entregue na Fase 4

| Item | Detalhe |
|------|---------|
| RPCs | `list_manager/admin_credit_settlements` (+ grouped) com `settlement_funding_type`, `release_at` |
| Labels | `src/utils/settlement-funding-labels.ts` — política “PIX/débito D+1 · cartão D+30…” |
| UI gestor | `/manager/credit/settlements` — título, coluna Meio, status “Em retenção” |
| UI admin | Painel/histórico de repasses — Meio + Liberação; copy sem D+1 universal |
| CSV | Colunas Meio (funding) + Prazo |
| Copy | Payout cadastro, financeiro, PDV, guia de relatórios, chargebacks |

### Entregue na Fase 5

| Item | Detalhe |
|------|---------|
| Fiscal | `pending_remit_now` = só `released`; `pending_retention` à parte (não misturar cartão retido) |
| Totais por meio | `summarize_settlement_ledgers_by_funding` + cards PIX/débito vs cartão |
| Filtros | Gestor e Admin: Todos / PIX-débito / Cartão |
| Relatórios | Posição, sintético, contábil, dashboard, CSV, e-mail chargeback — “modo banco” em vez de D+1 universal |
| Cron | `settlement_release_by_release_at` a cada 15 min (`process_*_releases` por `release_at`) |

---

## 12. Resposta pronta

Cliente **usa** crédito/ingresso na hora.  
Gestor **recebe** conforme o meio: **PIX/débito D+1**, **cartão** = data MP ou **D+30**.  
Carteira: o prazo do gestor segue a **origem da recarga** (FIFO) — **implementado nas Fases 2–3**.  
Não é desfazer o MP — é **alinhar o repasse ao caixa real**.

---

## 13. Relatórios revisados (Fase 5)

| Área | Onde | Situação |
|------|------|----------|
| Repasses ingresso/crédito | `/manager/credit/settlements` | Coluna meio, `release_at`, filtro e totais por prazo |
| Financeiro ingresso | `/manager/reports/financial` | Copy modo banco + prazos por meio |
| Admin créditos / settlements | Painel admin | Filtro PIX vs cartão; baixa só em `released` |
| Relatório fiscal sintético | Admin | “A pagar agora” ≠ retenção; labels modo banco |
| Guia de relatórios | `reports-guide` | Política PIX/débito D+1 · cartão D+30 |
| Chargeback ticket-only | Dívidas / e-mails | Sem D+1 universal |

---

*Handoff v0.2 + decisões 2026-08-24. Fases 0–5 implementadas.*
