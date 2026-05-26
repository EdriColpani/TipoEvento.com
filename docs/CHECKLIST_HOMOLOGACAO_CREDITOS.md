# Checklist de homologação — Créditos EventFest

**Atualizado:** 2026-05-19  
**Fluxo E2E:** recarga R$ 250 → ingresso → bar → pizzaria (cross-parceiro)  
**Relacionado:** [CHECKPOINT_CREDITOS_CLIENTE.md](./CHECKPOINT_CREDITOS_CLIENTE.md) · [WALLET_INSTALAR_CELULAR.md](./WALLET_INSTALAR_CELULAR.md)

Marque cada item antes de abrir o módulo para clientes reais.

---

## 0. Pré-voo (uma vez)

### Banco (Supabase — projeto correto)

- [ ] Migrations **Fases 1–7** aplicadas (SQL Editor, nesta ordem se faltar alguma):
  1. `supabase/migrations/20260620120000_client_credit_wallet_v31.sql`
  2. `supabase/migrations/20260621120000_credit_phase2_wallet_ux.sql`
  3. `supabase/migrations/20260622120000_credit_phase3_spend_tickets.sql`
  4. `supabase/migrations/20260623120000_credit_phase4_pdv.sql`
  5. `supabase/migrations/20260624120000_credit_phase5_admin_reports.sql`
  6. `supabase/migrations/20260625120000_credit_phase6_settlement_refund.sql`
  7. `supabase/migrations/20260626120000_credit_phase6_instant_mp_disbursement.sql`
  8. `supabase/migrations/20260627120000_credit_phase7_mobile_wallet.sql`

- [ ] Módulo ligado:

```sql
UPDATE public.system_billing_settings
SET consumption_module_enabled = true
WHERE id = 1;
```

- [ ] Comissão consumo e taxa MP estimada coerentes (admin ou SQL) — recarga R$ 250 precisa passar `fee_validation_ok`.

### Edge Functions

- [ ] Deploy:

```powershell
cd C:\V3\tipoevento
supabase functions deploy create-credit-checkout mercadopago-webhook credit-spend credit-spend-pdv issue-wallet-qr-token resolve-wallet-qr manager-credit-payout
```

### Secrets

- [ ] `PLATFORM_MP_ACCESS_TOKEN` (conta MP EventFest)
- [ ] `SITE_URL`, webhook MP apontando para `mercadopago-webhook`
- [ ] `ENTRY_QR_SIGNING_SECRET` (ou `WALLET_QR_SIGNING_SECRET`)
- [ ] **Homologação sem MP real no repasse:** `CREDIT_MP_SIMULATE_DISBURSE=true` (somente dev/staging)

### Empresas de teste (3 papéis)

| Papel | O quê configurar |
|--------|-------------------|
| **Empresa A — Evento** | Plano consumo/créditos; evento pago; **“Consumo com crédito”** ligado no evento; MP OAuth em Perfil da Empresa |
| **Empresa B — Bar** | Bar vinculado ao evento; estabelecimento **Bar** ativo em `/manager/credit/establishments` |
| **Empresa C — Pizzaria** | **Outra empresa**; evento próprio; estabelecimento **Pizzaria**; MP OAuth da empresa C |

- [ ] Admin: módulo créditos liberado no plano das 3 empresas
- [ ] Gestores A, B e C com **Conectar Mercado Pago** OK

### Contas de teste

- [ ] **Cliente** (carteira): e-mail/senha de homologação
- [ ] **Gestor A** (evento + bar), **Gestor C** (pizzaria)
- [ ] **Admin Master** para relatórios

### Valores sugeridos no roteiro

Ajuste aos preços reais do ambiente de teste:

| Etapa | Valor | Saldo após |
|--------|--------|------------|
| Recarga | +R$ 250 | R$ 250 |
| Ingresso | −R$ 80 | R$ 170 |
| Bar (PDV) | −R$ 30 | R$ 140 |
| Pizzaria cross | −R$ 50 | R$ 90 |

---

## 1. Recarga R$ 250 (origem: Evento A / Empresa A)

**Cliente:** `/wallet` → pacote **R$ 250** → checkout MP → pagar (PIX/cartão teste).

- [ ] Retorno MP: URL com `?status=success&topup_id=…` e saldo **R$ 250,00**
- [ ] Extrato: linha **Recarga** com descrição pública clara
- [ ] **Saldo creditado integral** (R$ 250 — taxa MP **não** reduz saldo do cliente)
- [ ] Admin/SQL: pedido pago com `fee_validation_ok = true`, `mp_fee_amount` preenchido
- [ ] Admin → `/admin/settings/credit-reports` → aba **Passivo**: passivo sobe ~R$ 250

**SQL rápido:**

```sql
SELECT id, gross_paid_amount, credit_granted_amount, mp_fee_amount, fee_validation_ok, status
FROM credit_topup_orders
ORDER BY created_at DESC LIMIT 3;
```

| Campo | Esperado |
|-------|----------|
| `gross_paid_amount` | 250.00 |
| `credit_granted_amount` | 250.00 |
| `fee_validation_ok` | true |
| `status` | paid (ou equivalente) |

**Obtido / OK:** _______________________

---

## 2. Ingresso com crédito (Empresa A)

**Cliente:** página do **Evento A** → comprar ingresso → **“Pagar com crédito EventFest”**.

- [ ] Opção de crédito visível (evento pago + consumo crédito habilitado + saldo suficiente)
- [ ] Compra concluída; pulseiras/ingressos emitidos
- [ ] Saldo cliente: **R$ 170** (se ingresso R$ 80)
- [ ] Extrato: **Uso de crédito** — Evento A / ingresso
- [ ] **Repasse MP imediato** (Fase 6.1): registro em `credit_mp_disbursements` **ou** simulação se `CREDIT_MP_SIMULATE_DISBURSE=true`
- [ ] Gestor A → `/manager/credit/settlements`: transferência/split do ingresso
- [ ] Extrato gestor: comissão EventFest + parte líquida gestor A

### Biometria (se valor ≥ threshold, padrão R$ 200)

- [ ] No celular/PWA: pede Face ID/digital **se** biometria ativada em `/wallet`
- [ ] Sem biometria ativa: erro orientando ativar na carteira
- [ ] Threshold `0` no SQL desliga a exigência:

```sql
UPDATE public.system_billing_settings
SET credit_spend_biometric_threshold = 0  -- ou 200 para ligar
WHERE id = 1;
```

**Obtido / OK:** _______________________

---

## 3. Bar — PDV (Empresa A, estabelecimento Bar)

**Cliente:** `/wallet` → **Mostrar QR no PDV** (TTL ~90s).

**Gestor A:** `/manager/credit/pdv` → escanear/colar token → identificar cliente → cobrar **R$ 30**.

- [ ] Cliente identificado com saldo **R$ 170**
- [ ] Cobrança OK; saldo **R$ 140**
- [ ] Extrato cliente: uso no **Bar** / Empresa A
- [ ] Gestor A → `/manager/reports/credit-spends`: linha do PDV
- [ ] Settlement/repasse MP para gestor A (bar)
- [ ] `credit_spend_line_items` com produto/quantidade (auditoria)

**Obtido / OK:** _______________________

---

## 4. Pizzaria — cross-parceiro (Empresa C)

Objetivo: provar que saldo da recarga na **Empresa A** vale na **Empresa C**.

**Cliente:** mesmo QR ou novo QR em `/wallet`.

**Gestor C:** `/manager/credit/pdv` → estabelecimento **Pizzaria** → cobrar **R$ 50**.

- [ ] Cobrança OK **sem** exigir nova recarga
- [ ] Saldo final **R$ 90**
- [ ] Extrato cliente: uso na **Pizzaria / Empresa C**
- [ ] **Gestor A não** recebe nada deste spend
- [ ] **Gestor C** vê repasse/settlement **somente** dos R$ 50
- [ ] Admin → `/admin/settings/credit-reports` → aba **Cross-empresa**: recarga origem A × spend receptor C
- [ ] Passivo plataforma: **R$ 90** (250 − 80 − 30 − 50)

**Obtido / OK:** _______________________

---

## 5. Carteira — UX e mobile (Fases 2 + 7)

- [ ] `/wallet` → **Onde usar** lista rede (eventos/parceiros)
- [ ] Exportar extrato **CSV**
- [ ] PWA: instalar no celular (ver [WALLET_INSTALAR_CELULAR.md](./WALLET_INSTALAR_CELULAR.md))
- [ ] Atalhos manifest: Carteira / Ingressos
- [ ] Biometria: `/wallet` → **Confirmação biométrica** → Ativar → testar spend alto
- [ ] Compras no mobile enviam `channel: app` (auditoria)

**Obtido / OK:** _______________________

---

## 6. Admin Master — painel completo

**Rota:** `/admin/settings/credit-reports`

| Aba | Validar |
|-----|---------|
| **Comissão consumo** | Totais batem com spends (ingresso + bar + pizzaria) |
| **Passivo** | ~R$ 90 vs soma saldos clientes |
| **Auditoria** | `credit_audit_log` com entradas dos spends |
| **Cross-empresa** | Origem recarga A → usos A e C |
| **Repasses** | Disbursements MP (ou simulados) |
| **Estornos** | (opcional) caso de teste de estorno |

**Obtido / OK:** _______________________

---

## 7. Gestores — visão por empresa

### Gestor A

- [ ] `/manager/reports/credit-spends`: ingresso + bar (não aparece pizzaria)
- [ ] `/manager/credit/settlements`: repasses só dos consumos em A
- [ ] `/manager/credit/establishments`: bar ativo

### Gestor C

- [ ] Relatório/settlements: **só** pizzaria R$ 50
- [ ] Não vê recarga R$ 250 do cliente

**Obtido / OK:** _______________________

---

## 8. Cenários de falha (recomendado antes de produção)

- [ ] **Saldo insuficiente:** PDV ou ingresso acima do saldo → erro claro, saldo inalterado
- [ ] **MP disburse falha** (staging sem simulate): spend **revertido** (saldo + ingresso se aplicável)
- [ ] **QR expirado:** token EFW após TTL → PDV recusa; cliente gera novo QR
- [ ] **Módulo desligado:** `consumption_module_enabled = false` → carteira/recarga bloqueadas com mensagem amigável
- [ ] **Webhook duplicado:** segunda notificação MP não credita em dobro (idempotência)

**Obtido / OK:** _______________________

---

## 9. Critério de go live

Marque **GO** só se:

- [ ] Fluxo completo **250 → ingresso → bar → pizzaria** OK
- [ ] Splits e repasses corretos **por empresa receptora**
- [ ] Passivo e extratos batem
- [ ] Cross-empresa auditável no admin
- [ ] OAuth MP de **todos** parceiros que vão receber repasse
- [ ] Termos/jurídico alinhados ([PLANO_CREDITOS_CLIENTE_JURIDICO.md](./PLANO_CREDITOS_CLIENTE_JURIDICO.md))
- [ ] Em produção: **`CREDIT_MP_SIMULATE_DISBURSE` desligado** e token MP EventFest real

**Responsável homologação:** _______________________  
**Data:** _______________________  
**Resultado:** [ ] GO  [ ] NO-GO  

---

## Ordem prática no dia do teste

```text
1. Pré-voo (SQL + deploy + OAuth × 3 empresas)
2. Cliente: recarga R$ 250
3. Cliente: ingresso com crédito (Empresa A)
4. Gestor A: PDV bar R$ 30
5. Gestor C: PDV pizzaria R$ 50  ← prova cross-parceiro
6. Admin: passivo + cross-empresa + repasses
7. Celular: PWA + biometria (opcional)
8. Falhas (saldo, QR, simulate off em staging MP)
```
