# Plano de teste — Compra de ingresso × Relatórios financeiros (coração do sistema)

**Produto:** EventFest  
**Escopo:** cadastro/validação da conta de recebimento (MP **ou** banco) → compra de ingresso (Mercado Pago **e** crédito EventFest) confrontada com os relatórios do gestor — bruto, taxa MP, comissão EventFest e líquido.  
**Fora de escopo:** cadastro de gestor/cliente, criação de evento (pré-condição), cortesia (só efeito colateral em estoque), PDV de produtos (exceto quando a compra de ingresso usa a mesma carteira).  
**Última atualização:** 2026-08-14  

---

## 0. Por que este plano existe

Cada real da compra precisa aparecer **igual** (ou com diferença justificada de centavos) em:

1. O que o cliente pagou / debitou  
2. O **Relatório Financeiro** (fonte da verdade de split)  
3. O **Relatório de Vendas** (bruto + quantidade)  
4. **Repasses D+1** (quando o dinheiro ainda não caiu no MP do gestor)  
5. **Consumos via crédito** (quando pagou com carteira EventFest)  

Se algum desses não bater, o “coração” do sistema está quebrado.

---

## 1. Glossário rápido (usar na planilha de conferência)

| Termo | Significado |
|-------|-------------|
| **Bruto** | Valor total da venda (`transaction_amount` / `gross` / `total_value`) |
| **Taxa MP (R$ / %)** | Fee do Mercado Pago (não é a comissão EventFest) |
| **Comissão EventFest (R$ / %)** | `marketplace_fee` / `platform_amount` — % da faixa do evento (MP) **ou** % de consumo (crédito) |
| **Líquido gestor / Recebido gestor** | O que fica (ou ficará) para o gestor |
| **Split Registrado** | Venda MP em modo conta do gestor — líquido já no MP |
| **Split Crédito** | Venda paga com carteira EventFest |
| **D+1 / Repasses** | Fila TED/PIX — ingresso modo banco **ou** crédito |
| **Identidade** | `Bruto ≈ Taxa MP + Comissão EF + Recebido gestor` (tolerância ± R$ 0,02) |

### Atenção crítica: % diferente por meio de pagamento

| Meio | % EventFest usada |
|------|-------------------|
| Mercado Pago (split ou D+1 banco) | `events.applied_percentage` (faixa de comissão de **ingresso**, congelada no evento) |
| Crédito EventFest | `% de consumo` da empresa (`hybrid_consumption_commission_pct` / `consumption_license_commission_pct` / default) — **não** a faixa de ingresso |

---

## 2. Pré-condições

### 2.1 Contas e planos

| # | Pré-condição |
|---|--------------|
| P1 | Gestor com plano que permite venda de ingresso (`ticket_commission` ou `ticket_plus_consumption`) |
| P2 | Evento **pago**, ativo, com lote com preço > 0 e estoque |
| P3 | Comissão EventFest do evento anotada (`applied_percentage`) — anotar no formulário de teste |
| P4 | Cliente com conta confirmada |
| P5a | **Modo A — MP split:** payout `mercado_pago` (conta MP do gestor conectada) |
| P5b | **Modo B — Banco D+1:** payout `bank_transfer` (PIX/conta) |
| P6 | Para crédito: evento com **“Aceitar pagamento com crédito EventFest”** ligado + cliente com saldo ≥ total |
| P7 | Para crédito: anotar a **% de consumo** vigente da empresa (não confundir com % do evento) |
| P8 | Conta de recebimento **validada** (PARTE ACC) antes das compras P0 |

### 2.2 Conta / recebimento do gestor (obrigatório analisar)

| # | Verificar | Onde |
|---|-----------|------|
| R1 | Perfil de recebimento cadastrado | `/manager/settings` → **Recebimento** (ou company-profile) |
| R2 | Modo: `mercado_pago` **ou** `bank_transfer` | Mesma tela |
| R3 | Se MP: conta conectada / válida (OAuth) | Status da conexão MP |
| R4 | Se banco: PIX ou dados bancários preenchidos | Chave PIX / conta |
| R5 | Parceira (`company_kind=partner`): costuma forçar banco | Confirmar no perfil |

> **Ingresso:** o modo payout **muda o caminho do dinheiro** — split no MP do gestor **ou** fila D+1 TED/PIX.  
> **Crédito (ingresso pago com carteira):** o líquido do gestor vai para **Repasses D+1 crédito**, independente de MP vs banco no perfil (o cadastro ainda define **para quem** Admin paga).

### 2.3 Folha de cálculo por compra (obrigatória)

Copiar uma linha por compra:

| Campo | Valor |
|-------|-------|
| Data/hora | |
| Evento / lote | |
| Qtd ingressos | |
| Preço unitário | |
| **Bruto esperado** | qty × preço |
| Meio | MP-split / MP-banco / Crédito |
| % EventFest esperada | (ingresso **ou** consumo) |
| R$ EventFest esperado | `round(bruto × % / 100, 2)` |
| R$ MP (só MP) | preencher após pagamento / extrato |
| Líquido esperado | `bruto − MP − EventFest` |
| ID transação / credit_spend | |
| Bruto no Financeiro | |
| MP no Financeiro | |
| EF no Financeiro | |
| Líquido no Financeiro | |
| Bruto no Rel. Vendas | |
| Linha em Repasses? | Sim/Não + valor |
| Linha em Consumos crédito? | Sim/Não + valor |
| Bate? | OK / FALHA |

**Tolerância:** ± R$ 0,02 por arredondamento. Acima disso = **bug**.

---

## 3. Rotas de referência

| Papel | Rota |
|-------|------|
| Recebimento gestor (MP / banco) | `/manager/settings` → Recebimento / company-profile |
| Compra | `/events/:id` |
| Meus ingressos / retorno MP | `/tickets` |
| Hub relatórios | `/manager/reports` |
| ★ Financeiro | `/manager/reports/financial` |
| Drill-down evento | `/manager/reports/financial/:eventId/:eventName` |
| Vendas | `/manager/reports/sales` |
| Consumos via crédito | `/manager/reports/credit-spends` |
| Repasses D+1 | `/manager/credit/settlements` (ou card Repasses) |
| Chargebacks ingresso | `/manager/reports/ticket-chargebacks` |
| Contábil créditos | `/manager/reports/credit-accounting` |

---

## 4. Smoke (obrigatório a cada release financeiro)

| ID | Caso | Prioridade |
|----|------|:----------:|
| SMK-00 | Conta Recebimento cadastrada (MP **ou** banco) + print | P0 |
| SMK-01 | 1 ingresso MP (split) → Financeiro bate identidade | P0 |
| SMK-02 | 1 ingresso MP (banco D+1) → Financeiro + Repasses | P0 |
| SMK-03 | 1 ingresso crédito → Financeiro + Consumos + Repasses crédito | P0 |
| SMK-04 | Rel. Vendas bruto = soma brutos pagos do Financeiro (mesmo filtro) | P0 |
| SMK-05 | Dashboard KPIs coerentes com Financeiro (mesmo dia) | P1 |

---

# PARTE ACC — Cadastro e validação da conta de recebimento (MP × banco)

Executar **antes** das compras P0. Sem destino de pagamento claro, o teste de split/D+1 fica inválido.

## ACC1. CT-ACC-ING-001 — Conta cadastrada e completa

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/settings` → Recebimento |

**Passos**
1. Abrir Recebimento e preencher checklist R1–R5.
2. Anotar: modo (`mercado_pago` / `bank_transfer`), status (completo / incompleto), tipo de empresa (organizador / parceira).
3. Print da tela (evidência obrigatória).

**Resultado esperado**
- [ ] Há destino claro de pagamento (MP conectado **ou** PIX/conta)
- [ ] Modo anotado no registro de execução
- [ ] Se incompleto: **não** seguir para SMK-01/02 até corrigir (ou executar ACC4)

---

## ACC2. CT-ACC-ING-002 — Cadastrar / conectar Mercado Pago

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Pré** | Empresa elegível a payout MP (não parceira forçada a banco, se for a regra) |

**Passos**
1. Selecionar modo **Mercado Pago**.
2. Conectar conta MP (OAuth) até status válido.
3. Salvar e reabrir a tela — conexão persiste.
4. Opcional: trocar de banco → MP e confirmar persistência.

**Resultado esperado**
- [ ] Conta MP conectada / válida
- [ ] UI mostra modo `mercado_pago`
- [ ] Após isso, compras MP devem seguir **CT-MP-SPLIT-001** (líquido no MP, sem D+1 ingresso)

**Negativos**
1. Tentar vender ingresso com OAuth expirado / desconectado.  
2. Documentar: bloqueia checkout do gestor? permite venda e falha no split?  

---

## ACC3. CT-ACC-ING-003 — Cadastrar dados bancários / PIX

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Selecionar modo **banco / transferência** (`bank_transfer`).
2. Preencher chave PIX e/ou dados bancários exigidos pela UI.
3. Salvar e reabrir — dados persistem (mascarados se aplicável).
4. Opcional: trocar de MP → banco e confirmar.

**Resultado esperado**
- [ ] Dados salvos e modo `bank_transfer`
- [ ] Após isso, compras MP do cliente devem seguir **CT-MP-BANK-001** (Financeiro + Repasses origem ingresso)
- [ ] Admin consegue ver destino para pagar D+1

**Negativos**
1. Salvar com PIX/conta vazios.  
2. Formato inválido de chave (se houver validação).  

---

## ACC4. CT-ACC-ING-004 — Conta ausente / incompleta

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. (Homolog) remover conexão MP **ou** limpar PIX/conta, conforme o modo.
2. Tentar: (a) publicar/ativar evento se houver gate; (b) cliente comprar ingresso; (c) Admin pagar D+1 (modo banco).

**Resultado esperado**
- [ ] Comportamento documentado:
  - bloqueio preventivo na UI/RPC **ou**
  - venda ok + falha/alerta no split / no pagamento Admin
- [ ] Se permitir venda sem destino: abrir bug/melhoria de processo

---

## ACC5. CT-ACC-ING-005 — Explicação MP × banco no ingresso (evidência conceitual)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

| Tema | Modo `mercado_pago` | Modo `bank_transfer` |
|------|---------------------|----------------------|
| Quem recebe no ato (cliente paga no MP) | Conta **MP do gestor** (split) | Conta **EventFest** (repassa depois) |
| Relatório Financeiro | Split **Registrado** | Split coerente com canal banco / D+1 |
| Repasses D+1 origem **ingresso** | **Não** cria linha | **Sim** — líquido = Financeiro |
| % EventFest | `events.applied_percentage` | Idem |
| Taxa MP na venda | Sim | Sim (checkout MP do comprador) |
| Ingresso pago com **crédito** | D+1 **crédito** (não split) | Idem |

**Passos**
1. Com a conta já cadastrada (ACC1), fazer **1** compra no modo atual.
2. Registrar na evidência: *“Modo payout = X; caminho = split **ou** D+1 ingresso; conta completa = Sim.”*
3. (Ideal em homolog) repetir com o **outro** modo (ACC2 ↔ ACC3) e comparar a matriz acima.

**Resultado esperado**
- [ ] QA demonstra que entendeu a diferença (print + frase na evidência)
- [ ] Números batem com a folha (± 0,02)

---

## ACC6. CT-ACC-ING-006 — Ingresso crédito × conta MP ou banco

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Em perfil **MP** e depois **banco** (ou um de cada em empresas distintas): 1 compra de ingresso com crédito.
2. Confirmar: Financeiro Split=Crédito; Consumos; Repasses D+1 **crédito** (não split MP).
3. Anotar: o modo do perfil **não** muda a fórmula; muda o **destino** do TED/PIX quando Admin paga.

**Resultado esperado**
- [ ] Mesma fórmula (% consumo) nos dois modos
- [ ] Sempre D+1 crédito — nunca “Registrado” no MP do gestor no ato

---

# PARTE A — Compra com Mercado Pago

## A1. CT-MP-SPLIT-001 — Compra feliz (modo split — conta MP do gestor)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Pré** | P1–P4, P5a |

**Passos — cliente**
1. Anotar: evento, lote, preço, qty, `applied_percentage`.
2. Em `/events/:id`, selecionar lote/qty e pagar com Mercado Pago.
3. Concluir pagamento aprovado no Checkout Pro.
4. Voltar a `/tickets` — ingresso emitido (QR).

**Passos — gestor (mesmo filtro: evento + dia)**
1. Abrir **Relatório Financeiro**.
2. Localizar a transação (status pago / aprovado).
3. Preencher a folha: bruto, %/R$ MP, %/R$ EF, Recebido gestor, Split = **Registrado**.
4. Abrir **Relatório de Vendas** — conferir receita e qtd.
5. Abrir **Repasses D+1** — **não** deve criar linha de origem ingresso (líquido já no MP).
6. Conferir estoque do lote (−qty).

**Cálculo esperado**
```
Bruto          = qty × unit_price
R$ EventFest   = round(Bruto × applied_percentage / 100, 2)
R$ MP          = taxa MP (fee_details; ≠ marketplace_fee)
Recebido gestor ≈ Bruto − R$ MP − R$ EventFest
                (ou net_received_amount do MP — deve bater com a coluna)
Identidade     : Bruto ≈ R$ MP + R$ EF + Recebido gestor
```

**Resultado esperado**
- [ ] Ingresso em Meus ingressos
- [ ] Financeiro: status pago; Split **Registrado**
- [ ] % Comissão sistema = `applied_percentage` do evento
- [ ] R$ Comissão ≈ fórmula acima
- [ ] Identidade fecha (± 0,02)
- [ ] Vendas: +bruto e +qtd iguais ao Financeiro
- [ ] Repasses: **sem** linha nova de ingresso D+1
- [ ] Admin (se testar): mesma comissão EventFest no mesmo filtro

---

## A2. CT-MP-BANK-001 — Compra feliz (modo banco D+1)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Pré** | P1–P4, P5b |

**Passos**
1. Mesma compra no MP (collector EventFest).
2. Financeiro: Split coerente com D+1 / canal banco.
3. **Repasses D+1**: linha origem **Ingresso** com `manager_amount` = Recebido gestor do Financeiro.
4. Anotar retenção (status retenção / a pagar conforme D+1 do sistema).

**Cálculo esperado**
```
Bruto        = checkout
R$ EventFest = round(Bruto × applied_percentage / 100, 2)
R$ MP        = taxa MP na cobrança EventFest
Líquido      = max(round(Bruto − R$ MP − R$ EventFest, 2), 0)
Repasses     = Líquido (origem ingresso)
```

**Resultado esperado**
- [ ] Financeiro e Repasses com o **mesmo líquido**
- [ ] Identidade fecha
- [ ] Vendas batem no bruto
- [ ] Dinheiro **não** caiu na conta MP do gestor no ato (cai na fila)

---

## A3. CT-MP-002 — Múltiplos ingressos / lotes na mesma compra

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Comprar 2+ unidades (mesmo lote ou lotes diferentes, se o checkout permitir).
2. Bruto = soma dos itens.
3. Conferir qtd de QRs emitidos = qty.
4. Financeiro: uma transação (ou N, conforme implementação) — total bruto e splits.

**Resultado esperado**
- [ ] Bruto = soma dos itens
- [ ] Comissão sobre o bruto total correto
- [ ] Qtd no Financeiro/Vendas = qty emitida

---

## A4. CT-MP-003 — Pagamento pendente / rejeitado / abandonado

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Casos**
1. Abandonar Checkout Pro sem pagar.  
2. Pagamento rejeitado (cartão teste).  
3. Pagamento pendente (boleto/Pix pendente, se aplicável).

**Resultado esperado**
- [ ] Financeiro lista pendente/falha **sem** somar nos totais de **pagos**
- [ ] Vendas **não** contabiliza como receita paga
- [ ] Estoque liberado se reserva expirou / falhou (sem overselling)
- [ ] Sem QR ativo de ingresso pago

---

## A5. CT-MP-004 — Retorno `/tickets` + botão verificar pagamento

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Após MP success, se ingresso demorar: usar verificar / reconciliar em Meus ingressos.
2. Conferir emissão e linha no Financeiro.

**Resultado esperado**
- [ ] Conciliação não duplica venda nem split
- [ ] Idempotência: clicar 2× não cria 2 receivables pagos

---

## A6. CT-MP-005 — Esgotamento de lote

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Comprar até zerar lote.
2. Tentar nova compra.

**Resultado esperado**
- [ ] Bloqueio sem overselling
- [ ] Totais financeiros = capacidade vendida do lote

---

# PARTE B — Compra com crédito EventFest

## B1. CT-CRED-001 — Compra feliz com carteira

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Pré** | P1–P4, P6, P7 |

**Passos — preparar**
1. Anotar saldo do cliente **antes**.
2. Anotar % de **consumo** da empresa (não a % do evento).
3. Anotar `applied_percentage` do evento (só para provar que **não** deve ser usada).

**Passos — cliente**
1. Em `/events/:id`, pagar com **crédito EventFest**.
2. Confirmar débito imediato e QR em `/tickets?status=success&credit_spend_id=...`.

**Passos — gestor**
1. **Financeiro:** linha com Split = **Crédito**; Taxa MP = **0**; % sistema = % consumo.
2. **Consumos via crédito:** mesma venda (bruto, comissão, líquido).
3. **Repasses D+1:** linha origem **Crédito** com líquido do gestor.
4. **Vendas:** bruto e qtd.
5. Saldo do cliente depois = antes − bruto.

**Cálculo esperado**
```
Bruto          = qty × preço
R$ MP          = 0
% EventFest    = % consumo (≠ applied_percentage do evento, em geral)
R$ EventFest   = round(Bruto × % consumo / 100, 2)
Líquido gestor = Bruto − R$ EventFest
```

**Resultado esperado**
- [ ] MP = 0 no Financeiro
- [ ] % ≠ faixa de ingresso (documentar os dois números)
- [ ] Financeiro ↔ Consumos crédito: bruto, EF e líquido iguais
- [ ] Repasses crédito = líquido
- [ ] Identidade: Bruto = 0 + EF + Líquido
- [ ] Extrato da carteira do cliente mostra o débito

---

## B2. CT-CRED-002 — Saldo insuficiente

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. Cliente com saldo < total.
2. Tentar pagar com crédito.

**Resultado esperado**
- [ ] Bloqueia com mensagem clara
- [ ] Sem receivable pago / sem QR
- [ ] Sem linha no Financeiro pago
- [ ] Saldo inalterado

---

## B3. CT-CRED-003 — Evento sem crédito habilitado

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Desmarcar “Aceitar pagamento com crédito” no evento.
2. Cliente com saldo tenta pagar com crédito.

**Resultado esperado**
- [ ] Opção indisponível ou erro
- [ ] Compra MP ainda funciona

---

## B4. CT-CRED-004 — Recarga + compra (cadeia)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Cliente recarrega carteira (fluxo de top-up vigente).
2. Compra ingresso com crédito.
3. Contábil de créditos / Consumos / Financeiro.

**Resultado esperado**
- [ ] Recarga não aparece como venda de ingresso no Financeiro
- [ ] Só a compra de ingresso gera linha de venda
- [ ] Contábil fecha o movimento de caixa do crédito

---

# PARTE C — Confrontar todos os relatórios

## C1. CT-REC-001 — Matriz de confronto (por compra)

Para **cada** compra P0 (MP-split, MP-banco, Crédito), marcar:

| Relatório | O que deve bater | MP-split | MP-banco | Crédito |
|-----------|------------------|:--------:|:--------:|:-------:|
| Financeiro — bruto | = checkout | [ ] | [ ] | [ ] |
| Financeiro — % EF | % ingresso / % consumo | [ ] | [ ] | [ ] |
| Financeiro — R$ EF | fórmula | [ ] | [ ] | [ ] |
| Financeiro — R$ MP | taxa MP / 0 | [ ] | [ ] | [ ] |
| Financeiro — líquido | bruto − MP − EF | [ ] | [ ] | [ ] |
| Financeiro — identidade | soma partes = bruto | [ ] | [ ] | [ ] |
| Financeiro — Split | Registrado / D+1 / Crédito | [ ] | [ ] | [ ] |
| Vendas — bruto | = soma brutos pagos | [ ] | [ ] | [ ] |
| Vendas — qtd | = ingressos emitidos | [ ] | [ ] | [ ] |
| Consumos crédito | mesma linha da compra crédito | N/A | N/A | [ ] |
| Repasses D+1 ingresso | = líquido | **Não** | [ ] | N/A* |
| Repasses D+1 crédito | = líquido | N/A | N/A | [ ] |
| Drill-down evento | unidades / estoque | [ ] | [ ] | [ ] |
| Dashboard (dia) | tendência coerente | [ ] | [ ] | [ ] |

\*Crédito usa ledger de crédito, não ingresso D+1.

---

## C2. CT-REC-002 — Totais do período (3 compras misturadas)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos**
1. No mesmo evento/dia: 1× MP-split **ou** MP-banco + 1× Crédito + 1× MP adicional.
2. Filtrar Financeiro pelo período.
3. Somar brutos pagos, comissões EF, líquidos.
4. Comparar:
   - Soma brutos Financeiro = Vendas (mesmo filtro)
   - Soma R$ EF ingresso (só MP) isolada da soma R$ EF crédito
   - Soma líquidos D+1 = linhas novas em Repasses (por origem)

**Resultado esperado**
- [ ] Totais do cabeçalho/rodapé do Financeiro = soma das linhas pagas
- [ ] Vendas não “some” comissão — só bruto/qtd
- [ ] Não misturar comissão de ingresso com comissão de consumo na análise

---

## C3. CT-REC-003 — Relatório Financeiro × Admin (se ambiente admin)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Mesmo filtro evento/período no Admin (receita / comissões).
2. Comparar soma Comissão EventFest de ingresso.

**Resultado esperado**
- [ ] Gestor e Admin batem na comissão de ingresso
- [ ] Crédito bate em Consumos / aba comissões crédito do Admin

---

## C4. CT-REC-004 — O que **não** deve misturar

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Verificar explicitamente**
1. Cortesia / lote R$ 0 **não** entra no bruto do Financeiro.  
2. Inscrição de evento grátis **não** entra no Financeiro de ingressos pagos.  
3. Mensalidade vitrine / licença consumo **não** entram como venda de ingresso.  
4. Recarga de carteira **não** é venda de ingresso.  
5. Relatório de Público / Movimentação / Eventos: operacionais — **não** usam para fechar caixa.

**Resultado esperado**
- [ ] Isolamento correto entre dinheiro de ingresso e demais módulos

---

# PARTE D — Chargeback e estorno (impacto nos números)

## D1. CT-CB-001 — Chargeback MP após venda paga

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Pré** | Venda MP paga registrada |

**Passos**
1. Simular/processar chargeback (ambiente de teste / admin).
2. Conferir Financeiro: some dos **pagos** / status refunded.
3. Relatório **Chargebacks de ingresso**: dívida = líquido do gestor da venda.
4. Ticket-only: instrução PIX `EF-TCB-{id}`; híbrido: offset em Repasses.

**Resultado esperado**
- [ ] Totais pagos caem
- [ ] Dívida = líquido original (não o bruto)
- [ ] Splits marcados como revertidos
- [ ] QR cancelado / inválido na portaria

---

## D2. CT-CB-002 — Pós-chargeback os totais batem de novo

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos**
1. Recalcular soma do período **sem** a venda estornada.
2. Vendas e Financeiro alinhados.

**Resultado esperado**
- [ ] Sem “fantasma” da venda nos totais pagos

---

# PARTE E — Casos de fronteira e estresse leve

## E1. CT-EDGE-001 — Preço com centavos (ex.: R$ 0,50 / R$ 19,90)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Resultado esperado**
- [ ] `round(..., 2)` coerente em EF e líquido
- [ ] Identidade fecha

---

## E2. CT-EDGE-002 — Duas compras simultâneas do último estoque

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Resultado esperado**
- [ ] Só uma venda paga consome a unidade
- [ ] Sem double-sell

---

## E3. CT-EDGE-003 — Webhook atrasado + verificar pagamento

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Resultado esperado**
- [ ] Uma única linha paga no Financeiro
- [ ] Um conjunto de QRs (sem duplicar analytics)

---

## E4. CT-EDGE-004 — Fila virtual (se evento com fila)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Resultado esperado**
- [ ] Compra só com sessão de fila válida
- [ ] Relatórios inalterados em regra de split

---

# PARTE F — Scripts de execução sugeridos

## F1. Roteiro do dia (mínimo coração — ~2–3 h)

1. **CT-ACC-ING-001** (+ **CT-ACC-ING-002** ou **CT-ACC-ING-003** conforme o modo) + print Recebimento.  
2. Preparar evento + anotar % ingresso e % consumo + modo payout.  
3. **CT-ACC-ING-005** (evidência conceitual MP × banco) embutida na 1ª compra.  
4. **CT-MP-SPLIT-001** *ou* **CT-MP-BANK-001** (conforme payout da empresa).  
5. **CT-CRED-001**.  
6. **CT-MP-002** (qty > 1).  
7. **CT-CRED-002**.  
8. **CT-REC-002** (totais do dia).  
9. **CT-REC-004**.  
10. **CT-EDGE-001**.  

## F2. Roteiro completo (release crítico)

Todos os P0 da **PARTE ACC** + partes A, B, C + D1 + E1 + E3 (+ ACC4/ACC6 se homolog permitir troca de modo).

---

## 5. Critérios de aceite (definição de pronto)

O coração está **OK** somente se:

- [ ] Conta de **Recebimento** cadastrada e documentada (MP conectado **ou** PIX/banco)  
- [ ] QA evidencia a diferença **split MP** vs **banco D+1** no ingresso  
- [ ] Toda compra **MP** gera linha no Financeiro com identidade fechada  
- [ ] `% EventFest` no MP = `applied_percentage` do evento  
- [ ] Toda compra **crédito** usa `% consumo`, MP = 0, e aparece em Financeiro **e** Consumos  
- [ ] Modo **split**: líquido **não** vai para Repasses ingresso  
- [ ] Modo **banco**: líquido do Financeiro = Repasses origem ingresso  
- [ ] Relatório de **Vendas** bate bruto e quantidade com o Financeiro (pagos)  
- [ ] Pendentes/falhas **não** incham totais pagos  
- [ ] Chargeback remove do pago e cria dívida pelo **líquido**  
- [ ] Cortesia/grátis/recarga **não** poluem o bruto de ingresso  

---

## 6. Evidências por compra P0

0. Print **Recebimento** (modo MP/banco + status da conta) — PARTE ACC  
1. Print do checkout (itens + total)  
2. Print Meus ingressos (QR / status)  
3. Print Financeiro (linha completa: bruto, MP, EF, líquido, Split)  
4. Print Vendas (totais do filtro)  
5. Print Repasses **ou** justificativa “N/A — split MP”  
6. Print Consumos crédito (se crédito)  
7. Folha de cálculo preenchida com “Bate? OK”  
8. Frase na evidência: *“Modo payout = X; caminho = split ou D+1; conta completa = Sim/Não”*  

---

## 7. Bugs típicos a observar (checklist negativo)

| Sintoma | Causa provável |
|---------|----------------|
| Venda split sem MP conectado | Gate de Recebimento ausente / OAuth morto |
| Banco sem PIX e Admin “paga” sem destino | Conta incompleta não bloqueada |
| % EF do crédito = % do evento | Bug: usou `applied_percentage` no crédito |
| Compra crédito com R$ MP > 0 | Bug de classificação / join errado |
| Split Registrado mas linha em Repasses ingresso | Mistura de canais |
| Vendas > Financeiro pagos | Contando pendente/cortesia/grátis |
| Identidade não fecha > 0,02 | Arredondamento ou fee MP mal classificada |
| Duas linhas pagas mesma compra | Falta idempotência webhook/verify |
| Líquido Repasses ≠ Financeiro | Ledger D+1 dessincronizado |
| Ingresso crédito caiu no MP do gestor no ato | Regressão (crédito deve ser D+1) |

---

## 8. Registro de execução

| Data | Tester | Ambiente | Build | Modo payout | Resultado | Bugs |
|------|--------|----------|-------|-------------|-----------|------|
| | | | | split / banco | | |
| | | | | | | |

---

## 9. Relação com outros planos

| Documento | Uso |
|-----------|-----|
| `PLANO_TESTE_CADASTRO_GESTOR_CLIENTE.md` | Pré: contas e plano comercial |
| `PLANO_TESTE_CADASTRO_EVENTO_CORTESIA.md` | Pré: evento/lotes; cortesia **fora** do caixa |
| `PLANO_TESTE_CONSUMO_CREDITO_PRODUTO.md` | Consumo: MP vs banco **não** muda D+1 do produto (só destino) |
| `QA_PAYOUT_MP_OR_BANK_D1.md` | Detalhe operacional do payout |
| Guia UI `/manager/reports` | Textos “o que deve bater” |

---

**Fim do plano.** Este é o critério mínimo para liberar mudança em checkout, webhook MP, crédito de ingresso ou Relatório Financeiro.
