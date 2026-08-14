# Plano de teste — Compra de produto com crédito EventFest (estabelecimento → consumo → relatórios → D+1)

**Produto:** EventFest  
**Escopo:** cadastro de estabelecimento e produtos pelo gestor → compra de produto pelo cliente (e/ou PDV) → confronto de relatórios de consumo, comissão EventFest e lançamentos D+1.  
**Inclui:** verificação da conta/recebimento do gestor e **explicação** Mercado Pago vs banco.  
**Fora de escopo:** venda de ingresso (ver `PLANO_TESTE_COMPRA_INGRESSO_RELATORIOS.md`), cortesia, cadastro de gestor.  
**Última atualização:** 2026-08-14  

---

## 0. Conceito do coração do consumo

```
Cliente tem saldo na carteira EventFest
        ↓
Compra produto (app/cardápio/QR) ou PDV debita a carteira
        ↓
Bruto debitado → Comissão EventFest (%) → Líquido gestor
        ↓
Sempre entra em Repasses D+1 (TED/PIX) — independente de MP ou banco no perfil
        ↓
Relatórios: Consumos · Contábil · Inventário · Repasses
```

### Regra de ouro (não confundir com ingresso)

| Tema | Ingresso | Consumo (produto) |
|------|----------|-------------------|
| % EventFest | `events.applied_percentage` (faixa de ingresso) | `% de consumo` da empresa (híbrido / licença / default ~8%) |
| Taxa Mercado Pago na venda | Sim (no checkout MP) | **Não** (débito de carteira) |
| Liquidação para o gestor | Split MP **ou** D+1 ingresso | **Sempre D+1 crédito** (TED/PIX) |
| Payout `mercado_pago` vs `bank_transfer` | Muda o caminho do **ingresso** | **Não muda** o caminho do **consumo** |

---

## 1. Glossário

| Termo | Significado |
|-------|-------------|
| **Estabelecimento** | Ponto de venda na rede (bar, food, loja) |
| **Preço cheio** | `unit_price` — usado no **PDV** |
| **Preço app** | Preço com `app_discount_pct` — usado no **cardápio do cliente** |
| **Bruto** | Valor debitado da carteira |
| **Comissão EF** | `round(bruto × % consumo / 100, 2)` |
| **Líquido gestor** | `bruto − comissão EF` |
| **D+1** | Retenção → liberado → pago (TED/PIX EventFest → gestor) |
| **PDV clássico** | Operador escaneia QR da carteira e lança itens — **não** baixa estoque do catálogo |
| **Cardápio / intent** | Cliente pede no app — **baixa estoque** e gera QR de entrega |

---

## 2. Pré-condições

### 2.1 Sistema e plano

| # | Pré-condição | Como conferir |
|---|--------------|---------------|
| S1 | Módulo de consumo/híbrido ligado globalmente | Admin → pricing / `system_billing_settings` |
| S2 | Empresa em plano **híbrido** (`ticket_plus_consumption`) **ou** **consumo/licença** (`consumption_or_license`) com licença do mês **paga** | Perfil → Plano |
| S3 | `% de consumo` anotada (híbrido / licença / default) | Admin pricing + anotar no formulário |
| S4 | Dias de retenção D+1 anotados (ex.: 1) | Settings crédito |
| S5 | Gestor logado com permissão de estabelecimento (não só operador PDV) | |

### 2.2 Conta / recebimento do gestor (obrigatório analisar)

| # | Verificar | Onde |
|---|-----------|------|
| R1 | Perfil de recebimento cadastrado | `/manager/settings` → **Recebimento** |
| R2 | Modo: `mercado_pago` **ou** `bank_transfer` | Mesma tela |
| R3 | Se MP: conta conectada / válida | Status OAuth MP |
| R4 | Se banco: dados bancários/PIX preenchidos | Chave PIX / conta |
| R5 | Parceira (`company_kind=partner`): costuma forçar banco | Confirmar no perfil |

> **Importante para o teste:** mesmo com MP conectado, o **líquido do consumo não cai no split do MP**. Ele vai para **Repasses D+1**. O cadastro de conta (MP ou banco) serve para a EventFest **saber para quem pagar** o TED/PIX do D+1 e, no caso de ingresso, para escolher split vs D+1 ingresso.

### 2.3 Folha de cálculo por compra de produto

| Campo | Valor |
|-------|-------|
| Canal | App cardápio / QR menu / PDV |
| Estabelecimento / produto | |
| Qty | |
| Preço cobrado (cheio ou com desconto) | |
| **Bruto** | |
| % consumo EF | |
| **R$ EF** | `round(bruto × % / 100, 2)` |
| **Líquido** | `bruto − R$ EF` |
| Saldo cliente antes / depois | |
| Estoque antes / depois (se app) | |
| ID spend / pedido | |
| Consumos relatório | |
| Contábil | |
| Inventário | |
| Repasses D+1 (valor + status) | |
| Bate? | OK / FALHA (± R$ 0,02) |

---

## 3. Rotas de referência

| Papel | Rota |
|-------|------|
| Estabelecimentos + catálogo | `/manager/credit/establishments` |
| PDV | `/manager/credit/pdv` |
| Operadores PDV | `/manager/settings/pdv-operators` |
| Recebimento gestor | `/manager/settings` (Recebimento) / company-profile |
| Carteira cliente | `/wallet` |
| Pedidos cliente | `/wallet/pedidos` |
| Cardápio evento | `/wallet/consumo/evento/:eventId` |
| Cardápio estabelecimento | `/wallet/consumo/estabelecimento/:establishmentId` |
| Menu via token QR | `/wallet/consumo?m=TOKEN` |
| ★ Consumos via crédito | `/manager/reports/credit-spends` |
| Contábil créditos | `/manager/reports/credit-accounting` |
| Inventário produtos | `/manager/reports/credit-product-inventory` |
| Repasses D+1 | `/manager/credit/settlements` |
| Licença consumo (se plano) | `/manager/reports/consumption-license` |

---

## 4. Explicação obrigatória — Mercado Pago × Banco (para o QA)

### 4.1 O que o gestor cadastra

| Modo | O que configura | Serve para |
|------|-----------------|------------|
| **Mercado Pago** | Conecta conta MP do gestor | **Ingressos:** split no ato (líquido cai na conta MP). **Consumo:** EventFest usa os dados/contato financeiros da operação; **pagamento do consumo continua D+1** |
| **Banco / PIX** | Conta ou chave PIX | **Ingressos:** EventFest cobra e repassa D+1. **Consumo:** repasse D+1 para essa conta/PIX |

### 4.2 Diferença prática no teste de **produto/consumo**

| Pergunta | Resposta |
|----------|----------|
| Consumo gera split MP no ato? | **Não** |
| Consumo gera linha em Repasses D+1? | **Sempre sim** (após a compra completed) |
| Trocar MP ↔ banco muda a fórmula bruto/EF/líquido do consumo? | **Não** |
| Trocar MP ↔ banco muda **para onde** o Admin envia o TED/PIX do D+1? | **Sim** (destino do pagamento) |
| Ingresso no mesmo gestor muda com MP ↔ banco? | **Sim** (split vs D+1 ingresso) — testar à parte |

### 4.3 Caso de teste conceitual (documentar na evidência)

**CT-PAYOUT-EXPLAIN-001**
1. Abrir Recebimento e anotar o modo atual (MP ou banco) + se dados estão completos.  
2. Fazer 1 compra de produto com crédito.  
3. Confirmar: Financeiro/Consumos mostram líquido; Repasses D+1 mostra o mesmo líquido.  
4. Registrar na evidência: *“Modo payout = X; consumo mesmo assim foi D+1; conta cadastrada = Sim/Não.”*

Se **conta não cadastrada / incompleta**:
- [ ] Sistema bloqueia operação de crédito? **ou**
- [ ] Permite vender mas Admin não consegue pagar D+1?  

Documentar o comportamento real (bug se permitir venda sem destino de pagamento quando a regra de negócio exige conta).

---

## 5. Smoke

| ID | Caso | P |
|----|------|:-:|
| SMK-01 | Criar estabelecimento + 1 produto ativo | P0 |
| SMK-02 | Cliente recarrega carteira | P0 |
| SMK-03 | Compra app (cardápio) → estoque − → Consumos + Repasses batem | P0 |
| SMK-04 | Compra PDV → Consumos + Repasses batem (estoque catálogo intacto) | P0 |
| SMK-05 | Conta recebimento cadastrada (MP ou banco) documentada | P0 |

---

# PARTE A — Cadastro do estabelecimento (gestor)

## A1. CT-EST-001 — Acesso e bloqueio por plano

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/credit/establishments` |

**Passos**
1. Com plano **só ingresso** (`ticket_commission`): tentar abrir estabelecimentos/PDV.
2. Com plano **híbrido** ou **consumo/licença (paga)**: abrir a tela.

**Resultado esperado**
- [ ] Plano inadequado: bloqueio/mensagem clara
- [ ] Plano adequado: lista de estabelecimentos

---

## A2. CT-EST-002 — Criar estabelecimento

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Campos**
- Nome (obrigatório)
- Evento (opcional — mesmo empresa)
- Endereço / mapa (se UI pedir)
- Aceita crédito = **ligado**
- Ativo = **sim**

**Negativos**
1. Nome vazio  
2. Desativar estabelecimento  
3. Desligar “aceita crédito”

**Resultado esperado**
- [ ] Salva e aparece na lista
- [ ] Inativo / sem aceite de crédito: cliente não consome nesse ponto

---

## A3. CT-EST-003 — Licença consumo bloqueando (plano consumption_or_license)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Licença do mês pendente/não paga.
2. Tentar PDV / estabelecimentos / consumo.

**Resultado esperado**
- [ ] `blocks_consumption` impede operação até pagar licença

---

# PARTE B — Cadastro de produtos (gestor)

## B1. CT-PROD-001 — Criar produto unitário

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Dados exemplo**
- Nome: `Cerveja Long Neck`
- Preço cheio: `12,00`
- Estoque: `100` (unidades)
- Embalagem: unidade
- Ativo: sim
- Foto: opcional
- Desconto app: `0%`

**Resultado esperado**
- [ ] Produto na lista do estabelecimento
- [ ] Aparece no cardápio do cliente (se estabelecimento/evento elegíveis)

---

## B2. CT-PROD-002 — Produto caixa (packaging box)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Tipo caixa + `units_per_box` (ex.: 12).
2. Quantidade em caixas.
3. Comprar no app e ver baixa de estoque coerente com a regra do sistema.

**Resultado esperado**
- [ ] Validação exige unidades por caixa
- [ ] Estoque decrementa conforme implementação

---

## B3. CT-PROD-003 — Desconto no app

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Preço cheio R$ 20,00; desconto app 10% → preço app R$ 18,00.
2. Comprar **1 un no cardápio** → bruto debitado = **18,00**.
3. Comissão e D+1 sobre **18,00** (não 20,00).
4. No **PDV**, lançar o mesmo produto → deve cobrar **20,00** (preço cheio), se o PDV usa catálogo com preço cheio **ou** item avulso — anotar comportamento.

**Resultado esperado**
- [ ] App: comissão/D+1 sobre valor com desconto
- [ ] Desconto 100% rejeitado
- [ ] Documentar diferença App vs PDV

---

## B4. CT-PROD-004 — Inativar produto / estoque zero

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Resultado esperado**
- [ ] Inativo some do cardápio
- [ ] Estoque 0 some do cardápio
- [ ] PDV: comportamento documentado (pode ou não listar)

---

# PARTE C — Preparar cliente (carteira)

## C1. CT-WAL-001 — Recarga de crédito

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/wallet` |

**Passos**
1. Anotar saldo antes.
2. Recarregar (Pix/cartão conforme fluxo vigente — cartão 1x se for a regra).
3. Aguardar aprovação.
4. Saldo depois = antes + crédito líquido creditado.

**Resultado esperado**
- [ ] Saldo atualiza
- [ ] Contábil do gestor/admin registra recarga (não como “consumo de produto”)
- [ ] Recarga **não** gera linha de Consumos de produto nem D+1 de spend

---

## C2. CT-WAL-002 — Evento com consumo habilitado (se cardápio por evento)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. No evento: ligar **Aceitar pagamento com crédito EventFest** / consumo.
2. Vincular estabelecimento ao evento (se aplicável).
3. Cliente abre `/wallet/consumo/evento/:eventId`.

**Resultado esperado**
- [ ] Catálogo lista produtos ativos com estoque

---

# PARTE D — Compra pelo cliente (app / cardápio)

## D1. CT-APP-001 — Compra feliz no cardápio (estabelecimento ou evento)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Folha: produto, qty, preço app, % consumo, estoque e saldo antes.
2. Cliente adiciona ao carrinho e confirma (biometria se valor ≥ threshold, ex. R$ 200).
3. Pedido em `/wallet/pedidos` (status até retirada).
4. Gestor confirma entrega (QR `EFDEL.*` / fluxo de entrega), se o canal gerar entrega.

**Conferência gestor (mesmo momento)**
1. **Consumos via crédito:** bruto, comissão, líquido.  
2. **Contábil créditos:** consumo listado.  
3. **Inventário produtos:** vendido +; estoque − (porque app envia `product_id`).  
4. **Repasses D+1:** linha `pending` com `manager_amount` = líquido; `release_at` ≈ agora + retenção.

**Cálculo**
```
Bruto     = preço_app × qty
R$ EF     = round(Bruto × %consumo / 100, 2)
Líquido   = Bruto − R$ EF
Saldo'    = Saldo − Bruto
Estoque'  = Estoque − qty   (regra do packaging)
```

**Resultado esperado**
- [ ] Todos os valores batem (± 0,02)
- [ ] Taxa MP na linha de consumo = 0 / N/A
- [ ] D+1 criado automaticamente

---

## D2. CT-APP-002 — Saldo insuficiente (app)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Resultado esperado**
- [ ] Erro claro
- [ ] Sem débito, sem D+1, sem baixa de estoque

---

## D3. CT-APP-003 — Estoque insuficiente (app)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Resultado esperado**
- [ ] Bloqueia na intent ou no pagamento
- [ ] Sem leave saldo inconsistente (se spend falhar, estoque intacto; se edge case, registrar bug)

---

## D4. CT-APP-004 — Compra via QR do menu (token balcão)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Gestor gera token do cardápio no PDV/estabelecimento.
2. Cliente abre `/wallet/consumo?m=TOKEN`.
3. Compra 1 item.

**Resultado esperado**
- [ ] Mesmo fechamento financeiro do D1

---

## D5. CT-APP-005 — Entrega / QR EFDEL

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Após pagamento app, pedido aguardando retirada.
2. Operador lê QR de entrega.
3. Status `completed`.
4. Reutilizar QR → erro/duplicate.

**Resultado esperado**
- [ ] Entrega única
- [ ] Relatórios já tinham o spend no pagamento (entrega não duplica cobrança)

---

# PARTE E — Compra no PDV (gestor/operador)

## E1. CT-PDV-001 — Débito clássico (QR carteira + itens)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/credit/pdv` |

**Passos**
1. Abrir PDV, selecionar estabelecimento.
2. Ler QR da carteira do cliente.
3. Lançar produto(s) / valores.
4. Confirmar débito.

**Conferência**
- Consumos: bruto / EF / líquido  
- Repasses D+1: mesmo líquido  
- Inventário: **em geral NÃO altera** estoque do catálogo (PDV clássico sem `product_id`) — **obrigatório validar e documentar**  
- Contábil: registra consumo

**Resultado esperado**
- [ ] Débito OK
- [ ] Números batem
- [ ] Diferença de inventário vs app documentada (não tratar como bug se for regra)

---

## E2. CT-PDV-002 — Saldo insuficiente no PDV

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Resultado esperado**
- [ ] Bloqueia antes/no RPC
- [ ] Sem D+1

---

## E3. CT-PDV-003 — Cancelamento / rollback de consumo pago

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Consumo completed.
2. Cancelar com motivo (fluxo gestor disponível).
3. Verificar: saldo devolvido; spend reversed; ledger D+1 cancelled; estoque devolvido **se** havia baixa.

**Resultado esperado**
- [ ] Cliente reembolsado na carteira
- [ ] Relatórios não mantêm líquido “pago” indevido
- [ ] D+1 cancelado/clawback conforme status

---

## E4. CT-PDV-004 — Operador PDV sem permissão de cadastro

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Resultado esperado**
- [ ] Opera PDV
- [ ] Não cadastra estabelecimento (se regra `canManageEstablishments = false`)

---

# PARTE F — Confrontar todos os relatórios de consumo

## F1. CT-REP-CONS-001 — Matriz por compra

| Relatório | O que bater | App | PDV |
|-----------|-------------|:---:|:---:|
| Consumos — bruto | = débito carteira | [ ] | [ ] |
| Consumos — % / R$ EF | fórmula % consumo | [ ] | [ ] |
| Consumos — líquido | bruto − EF | [ ] | [ ] |
| Contábil — linha consumo | mesmo bruto | [ ] | [ ] |
| Inventário — vendido/estoque | qty com product_id | [ ] | N/A* |
| Repasses D+1 — manager_amount | = líquido | [ ] | [ ] |
| Repasses — status inicial | pending | [ ] | [ ] |
| Dashboard consumo do dia | coerente (gross completed) | [ ] | [ ] |
| Relatório Financeiro de **ingresso** | **não** inclui este consumo como ingresso MP | [ ] | [ ] |

\*PDV clássico tipicamente N/A no inventário de catálogo.

---

## F2. CT-REP-CONS-002 — Totais do dia (2 app + 1 PDV)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Três compras no mesmo estabelecimento/dia.
2. Somar brutos e líquidos na folha.
3. Comparar totais de Consumos e soma das linhas D+1 novas.

**Resultado esperado**
- [ ] Soma das linhas = totais do relatório
- [ ] Contábil não conta recarga como consumo de produto

---

## F3. CT-REP-CONS-003 — Ciclo D+1 (retenção → liberado → pago)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Após compra: status **pending**, anotar `release_at`.
2. Avançar tempo / job `process_credit_settlement_releases` (homolog) → **released**.
3. Admin registra pagamento TED/PIX → **paid** (com comprovante se houver).
4. Contábil / lista de repasses reflete pago.

**Resultado esperado**
- [ ] Transições corretas
- [ ] Valor constante (líquido) em todos os status
- [ ] Destino do pagamento alinhado à conta cadastrada (MP perfil vs PIX/banco — conferir com Admin)

---

## F4. CT-REP-CONS-004 — Isolamento (o que não pode aparecer)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Verificar**
- [ ] Compra de **ingresso** MP não entra como linha de produto em Consumos (salvo ingresso pago com crédito — outro plano)
- [ ] Cortesia não gera consumo
- [ ] Recarga não gera D+1 de spend
- [ ] Mensalidade/licença não entra como consumo de produto

---

# PARTE G — Conta do gestor + MP vs banco (casos de teste)

## G1. CT-ACC-001 — Conta cadastrada e completa

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Checklist R1–R5.
2. Print da tela Recebimento.
3. Após 1 consumo, Admin visualiza dados para pagar D+1.

**Resultado esperado**
- [ ] Há destino claro de pagamento
- [ ] Evidência anexa modo MP ou banco

---

## G2. CT-ACC-002 — Mesmo consumo com perfil MP

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Pré** | payout_mode = mercado_pago |

**Passos**
1. 1 compra produto crédito.
2. Confirmar D+1 gerado (não split MP).
3. Anotar: conta MP conectada **não** recebeu o líquido do consumo no ato.

**Resultado esperado**
- [ ] D+1 existe
- [ ] Extrato MP do gestor **não** mostra split de consumo

---

## G3. CT-ACC-003 — Mesmo consumo com perfil banco

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Pré** | payout_mode = bank_transfer + PIX/conta OK |

**Passos**
1. 1 compra produto crédito.
2. Confirmar D+1 com mesmo cálculo.
3. Admin paga para a chave/conta cadastrada.

**Resultado esperado**
- [ ] Mesma fórmula de comissão
- [ ] Pagamento D+1 direcionado ao banco/PIX

---

## G4. CT-ACC-004 — Conta ausente / incompleta

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. (Homolog) remover/invalidar dados de recebimento se possível.
2. Tentar consumo e/ou liberação de pagamento Admin.

**Resultado esperado**
- [ ] Comportamento documentado (bloqueio preventivo **ou** venda ok + pagamento Admin bloqueado)
- [ ] Se permitir venda sem conta: abrir melhoria/bug de processo

---

# PARTE H — Casos especiais

## H1. CT-X-001 — Chargeback de recarga após consumo

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Recarregar → gastar em produto → chargeback da recarga.
2. Ver clawback no D+1 / saldo.

**Resultado esperado**
- [ ] Impacto no ledger do gestor documentado (FIFO clawback)
- [ ] Consumo original permanece auditável

---

## H2. CT-X-002 — Cross-estabelecimento / outra empresa

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos**
1. Cliente gasta no estabelecimento da empresa B.
2. Comissão e D+1 vão para **B**, não para A.

**Resultado esperado**
- [ ] Recebedor = empresa do estabelecimento

---

## H3. CT-X-003 — Idempotência (double submit)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Resultado esperado**
- [ ] Um único spend / um único D+1

---

## H4. CT-X-004 — Biometria / threshold alto

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos**
1. Compra app ≥ limiar (ex. R$ 200).
2. Fluxo pede verificação extra se configurado.

---

# PARTE I — Roteiros de execução

## I1. Roteiro mínimo (coração do consumo) — ~3 h

1. G1 (conta cadastrada + anotar MP ou banco)  
2. A2 estabelecimento  
3. B1 produto + B3 desconto (opcional rápido)  
4. C1 recarga  
5. D1 compra app + F1 + F3 (pelo menos pending)  
6. E1 compra PDV + F1  
7. F2 totais do dia  
8. G2 ou G3 conforme o modo da conta  

## I2. Roteiro release completo

Todos P0 + F3 até **paid** + E3 cancelamento + H3 idempotência + A1 bloqueio de plano.

---

## 6. Critérios de aceite

O módulo de consumo está **OK** se:

- [ ] Gestor cadastra estabelecimento e produto em plano elegível  
- [ ] Conta de recebimento (MP **ou** banco) está analisada e documentada  
- [ ] Cliente compra no app com débito correto e baixa de estoque  
- [ ] PDV debita carteira com números corretos (estoque catálogo conforme regra)  
- [ ] Consumos: bruto, % EF, líquido batem com a folha  
- [ ] Contábil reflete o consumo  
- [ ] Inventário reflete vendas **do app** (com product_id)  
- [ ] **Todo** consumo gera D+1 com líquido = relatório  
- [ ] QA entende e evidencia: **MP vs banco não muda D+1 do consumo**; muda destino/ingresso  
- [ ] Recarga ≠ consumo nos relatórios  

---

## 7. Evidências

1. Print Recebimento (modo MP/banco + dados)  
2. Print estabelecimento + produto  
3. Print carteira antes/depois  
4. Print pedido/compra cliente ou PDV  
5. Print Consumos (linha completa)  
6. Print Contábil  
7. Print Inventário (app)  
8. Print Repasses D+1 (pending → released → paid se possível)  
9. Folha de cálculo com “Bate? OK”  

---

## 8. Bugs típicos

| Sintoma | Hipótese |
|---------|----------|
| Comissão no app sobre preço cheio | Ignorou desconto app |
| Consumo sem linha D+1 | Trigger/split falhou |
| D+1 ≠ líquido Consumos | Arredondamento / canal errado |
| Inventário não anda no app | Falta product_id / stock decrement |
| Inventário andou no PDV clássico | Mudança de regra — revalidar |
| Líquido caiu no MP do gestor no ato | Regressão (consumo não deve splitar) |
| Conta vazia e Admin “paga” sem destino | Falha de processo |

---

## 9. Registro de execução

| Data | Tester | Ambiente | Build | Payout mode | Resultado | Bugs |
|------|--------|----------|-------|-------------|-----------|------|
| | | | | MP / banco | | |

---

## 10. Relação com outros planos

| Documento | Uso |
|-----------|-----|
| `PLANO_TESTE_COMPRA_INGRESSO_RELATORIOS.md` | Ingresso MP/crédito (não produto) |
| `QA_CLIENT_CREDIT_CATALOG.md` | Detalhe cardápio/estoque/entrega |
| `QA_PAYOUT_MP_OR_BANK_D1.md` | MP vs banco; consumo sempre D+1 |
| `PLANO_TESTE_CADASTRO_GESTOR_CLIENTE.md` | Contas e plano comercial |
| `CHECKPOINT_RECARGA_CREDITO_1X_CHARGEBACK.md` | Chargeback de recarga |

---

**Fim.** Este plano fecha o ciclo: **estabelecimento → produto → compra → comissão → D+1 → conta do gestor (MP ou banco)**.
