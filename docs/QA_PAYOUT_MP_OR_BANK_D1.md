# QA — Recebimento opcional (MP ou banco) + D+1 ingresso

Checklist manual (dev → test → prod). Aplicar migrations:

- `20260824120000_company_payout_optional_mp_bank.sql`
- `20260824130000_ticket_settlement_lists_and_payment.sql`
- `20260824140000_ticket_settlement_position_totals.sql`

Redeploy edge functions: `create-payment-preference`, `mercadopago-webhook`.

## 1. Gestor só Mercado Pago

- [ ] Perfil da Empresa → Recebimento → modo MP → conectar OAuth/token → Confirmar modo
- [ ] Criar evento pago OK
- [ ] Go-live: item “Recebimento configurado” = pass
- [ ] Compra ingresso: split no ato (`marketplace_fee` > 0)
- [ ] Relatório financeiro: Split Registrado; sem linha em Repasses D+1 de ingresso
- [ ] Compra com crédito (se híbrido): D+1 crédito OK

## 2. Gestor só conta bancária / PIX

- [ ] Sem dados: criar evento bloqueado + CTA Recebimento
- [ ] Preencher banco/agência/conta/titular/doc/PIX → salvar
- [ ] Criar evento OK; go-live payout OK
- [ ] Compra: cobrança na MP EventFest; `settlement_channel=manual_d1`
- [ ] Ledger ingresso `pending` → após D+1 `released`
- [ ] Admin Repasses: vê PIX/banco, copia chave, registra pagamento
- [ ] Gestor Repasses: status pago + origem Ingresso D+1

## 3. Troca de modo

- [ ] Com evento pago ativo: gestor não troca MP → banco (erro)
- [ ] Admin Master pode trocar

## 4. Parceira

- [ ] Aba Recebimento só banco/PIX
- [ ] Consumo crédito gera D+1; Admin vê dados bancários no card

## 5. Chargeback

- [ ] Modo MP: pipeline chargeback + dívida
- [ ] Modo banco (collector plataforma): chargeback + dívida; ticket-only = PIX EventFest; híbrido = offset D+1

## 6. Relatórios Admin

- [ ] Repasses: crédito + ingresso, origem, PIX
- [ ] Posição financeira: métricas Ingressos D+1
- [ ] Contábil / comissões: comissão ingresso bank_transfer em `financial_splits`
- [ ] Chargebacks: casos com pagamento plataforma

## 8. Contratos

- [ ] Plano só ingresso (`ticket_commission`): cláusulas 3.4–3.7 com MP split vs banco D+1
- [ ] Plano híbrido: cláusula 4.4 atualizada com os dois modos
- [ ] Empresas com plano de ingresso pedem reaceitação do contrato no painel
