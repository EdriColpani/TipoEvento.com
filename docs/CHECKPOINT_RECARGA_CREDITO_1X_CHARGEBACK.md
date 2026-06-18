# Checkpoint — Recarga de crédito: 1x + chargeback (próxima sessão)

**Status:** Fase 1 implementada (2026-06-10) — Fase 2 chargeback implementada (2026-07-23)  
**Decisão acordada (2026-06-09):**

| Regra | Detalhe |
|-------|---------|
| Pix | Sem mudança — crédito integral na aprovação |
| Cartão na recarga | Apenas **1x** (bloquear parcelamento) |
| Chargeback na recarga | 1) Estornar saldo cliente → 2) Clawback proporcional gestor(es) → 3) EventFest absorve resto |

---

## Fase 1 — Amanhã (rápido, alto impacto)

**Arquivo:** `supabase/functions/create-credit-checkout/index.ts`

Incluir na preferência MP:

```json
"payment_methods": {
  "installments": 1,
  "default_installments": 1
}
```

**Deploy:**

```powershell
supabase functions deploy create-credit-checkout --project-ref lzsjxepcgswsnpsjzpcm
```

**Teste:** recarga R$ 50 — checkout MP deve mostrar cartão só à vista; Pix continua disponível.

---

## Fase 2 — Chargeback (implementada)

**Migration:** `supabase/migrations/20260723120000_credit_topup_chargeback.sql`

- RPC `credit_topup_handle_mp_chargeback` (idempotente via `chargeback:{mp_payment_id}`)
- Tabela auditoria `credit_topup_chargeback_cases`
- Webhook trata `charged_back`, `refunded`, `partially_refunded` em `credit_topup:*`

**Deploy:**

```powershell
supabase db push --project-ref lzsjxepcgswsnpsjzpcm
supabase functions deploy mercadopago-webhook --project-ref lzsjxepcgswsnpsjzpcm
```

**Teste:** recarga paga → simular chargeback no MP → verificar saldo, settlements `clawback`, topup `refunded`.

**Pendente (jurídico):** ~~cláusula contratual gestor~~ — aditivo aplicado em `20260723150000_credit_chargeback_contract_clauses.sql` (reaceite automático nos planos `ticket_plus_consumption` e `consumption_or_license`).

**Referência análise:** conversa sobre Pix vs 12x, passivo EventFest, repasse imediato ao gestor.

---

## Não fazer na recarga

- Parcelamento 2x–12x
- Crédito integral sem política de chargeback quando cliente já gastou tudo

## Ingresso direto (sem carteira)

Regra pode ser diferente — avaliar separadamente se parcelamento é permitido.

---

## Arquivos relacionados

- `supabase/functions/create-credit-checkout/index.ts`
- `supabase/functions/mercadopago-webhook/index.ts`
- `docs/PLANO_CREDITOS_CLIENTE_JURIDICO.md`
- `supabase/functions/_shared/credit-mp-disbursement.ts`
