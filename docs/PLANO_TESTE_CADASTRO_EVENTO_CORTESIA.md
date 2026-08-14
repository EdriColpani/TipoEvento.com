# Plano de teste — Cadastro de evento e cortesias

**Produto:** EventFest (gestor)  
**Escopo:** cadastro/edição de evento **sem** pacotes cortesia; e fluxo **completo** quando optar por cortesia (lote gratuito + envio + resgate).  
**Ambiente sugerido:** homologação / conta gestor de teste com plano que permite venda de ingressos.  
**Última atualização:** 2026-08-14  

---

## 0. Pré-condições gerais

| # | Pré-condição | Como conferir |
|---|--------------|---------------|
| P1 | Gestor logado (PJ) com empresa vinculada | Menu Gestor / Perfil |
| P2 | Plano comercial aceito (contrato do plano) | Perfil da Empresa → Plano |
| P3 | Recebimento configurado (MP e/ou conta/PIX), se o plano exige venda | Perfil → Recebimento |
| P4 | Sem bloqueio por chargeback (3 dívidas) | Banner de bloqueio ausente |
| P5 | Sem bloqueio por inatividade de ingresso (se aplicável) | Banner de inatividade |
| P6 | Contrato de adesão da empresa já assinado (OTP), se o fluxo de onboarding exigir | `/manager/register` pós-empresa |

**Contas auxiliares (cenário com cortesia):**
- Conta **convidado A** (e-mail válido) — resgata o pacote  
- Conta **convidado B** (opcional) — recebe ingresso redistribuído pelo titular do pacote  
- Celular/portaria com validador (`/validator`) e chave do evento  

**Legendas de resultado:** `[ ]` não executado · `[x]` OK · `[F]` falhou  

---

## 1. Rastreio rápido (smoke)

Execute nesta ordem após cada release que toque em evento/lotes/cortesia:

| ID | Caso | Sem cortesia | Com cortesia |
|----|------|:------------:|:------------:|
| SMK-01 | Criar evento pago com 1 lote de venda | ✓ | ✓ |
| SMK-02 | Evento aparece em `/manager/events` e na vitrine | ✓ | ✓ |
| SMK-03 | Compra online de 1 ingresso pago | ✓ | ✓ |
| SMK-04 | Marcar lote cortesia + salvar | | ✓ |
| SMK-05 | Criar pacote + copiar link | | ✓ |
| SMK-06 | Resgate do link pelo convidado | | ✓ |
| SMK-07 | Validação na portaria do ingresso cortesia | | ✓ |

---

## 2. Cadastro de evento **SEM** pacotes cortesia

### 2.1 CT-EVT-SEM-001 — Criar evento pago (só lotes de venda)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/events/create` |
| **Pré** | P1–P5 |

**Passos:**
1. Abrir **Criar Novo Evento**.
2. (Opcional) Abrir **Como preencher** e conferir campos obrigatórios.
3. Preencher **obrigatórios:** título, data, hora, local, endereço, imagens (card + exposição), categoria, capacidade, duração, idade mínima.
4. Aceitar contrato do evento, se a etapa existir.
5. Em ingressos/preço: evento **pago**.
6. Criar **apenas lotes de venda** (preço > R$ 0), ex.:
   - Lote 1: Standard · 100 · R$ 50,00 · datas de venda
   - Lote 2 (opcional): VIP · 20 · R$ 120,00
7. **Não** marcar “Lote cortesia / gratuito”.
8. Salvar evento.
9. Seguir checklist pós-criação (ir a eventos / editar / estoque, conforme modal).

**Resultado esperado:**
- [ ] Evento salvo sem erro
- [ ] Aparece em `/manager/events`
- [ ] Lotes com preço > 0 visíveis na edição
- [ ] Na vitrine/detalhe público, preço “a partir de” reflete o **menor lote pago** (não R$ 0)
- [ ] Botão/atalho de cortesias pode existir, mas **não é obrigatório** neste cenário

---

### 2.2 CT-EVT-SEM-002 — Validações do formulário (sem cortesia)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/events/create` |

**Passos / tentativas negativas:**
1. Salvar sem título / sem data / sem imagens → deve barrar.
2. Evento pago **sem nenhum lote** → deve barrar.
3. Lote com preço vazio → deve barrar.
4. Digitar preço `0,00` **sem** marcar cortesia → deve pedir para marcar “Lote cortesia / gratuito”.
5. Só lotes cortesia (todos R$ 0) **sem** lote de venda → deve barrar (“inclua pelo menos um lote de venda”).
6. Quantidade inválida (0, texto) → deve barrar.
7. Data fim do lote antes da data início → deve barrar.

**Resultado esperado:**
- [ ] Todas as tentativas exibem erro claro
- [ ] Nada é persistido com dados inválidos

---

### 2.3 CT-EVT-SEM-003 — UX número de lotes (+ / −)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Usar botões **+** e **−** (não setinhas do input).
2. Aumentar para 3 lotes; diminuir para 1.
3. Confirmar que cards Lote 1…N aparecem/desaparecem.

**Resultado esperado:**
- [ ] + aumenta, − diminui (sem clique invertido)
- [ ] Limite mínimo 1 e máximo 20 respeitados

---

### 2.4 CT-EVT-SEM-004 — Categoria (+ nova categoria)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos:**
1. Clicar no botão **+** ao lado de Categoria.
2. Criar categoria nova e selecioná-la.
3. Conferir cor do botão (padrão do sistema, sem fundo branco).

**Resultado esperado:**
- [ ] Categoria criada e selecionável
- [ ] Botão no padrão de cores (accent do tema)

---

### 2.5 CT-EVT-SEM-005 — Publicação e venda (sem cortesia)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Ativar/publicar o evento (checklist go-live, se existir).
2. Abrir página pública do evento.
3. Comprar 1 ingresso do lote Standard (checkout MP / fluxo vigente).
4. Confirmar ingresso em “Meus ingressos” do cliente.
5. (Opcional) Validar na portaria com chave de entrada/saída.

**Resultado esperado:**
- [ ] Estoque do lote diminui
- [ ] Relatório financeiro / vendas registra a compra
- [ ] Ingresso validável

---

### 2.6 CT-EVT-SEM-006 — Edição após vendas (sem cortesia)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/manager/events/edit/:id` |

**Passos:**
1. Com pelo menos 1 venda, abrir edição.
2. Tentar reduzir quantidade do lote abaixo do vendido / alterar preço se bloqueado.
3. Aumentar quantidade do lote (se regra permitir só aumento).

**Resultado esperado:**
- [ ] Guards de venda respeitados
- [ ] Aumento de estoque permitido quando aplicável
- [ ] Ingressos já vendidos intactos

---

### 2.7 CT-EVT-SEM-007 — Chave de validação (sem cortesia)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/manager/validation-keys` |

**Passos:**
1. Nova chave → colaborador + evento + tipo entrada/saída.
2. Copiar chave de 8 caracteres.
3. Abrir `/validator`, liberar chave, validar um ingresso pago.

**Resultado esperado:**
- [ ] Chave criada e expiração coerente com o evento
- [ ] Validação de entrada OK

---

## 3. Cadastro de evento **COM** opção de pacote cortesia

> **Regra de produto:** cortesia **não** é “Cadastro de ingresso” com valor 0.  
> Cortesia = lote marcado **“Lote cortesia / gratuito”** (preço R$ 0) + tela **Pacotes cortesia** + link ao convidado.

### 3.1 CT-EVT-COR-001 — Criar evento com lote de venda + lote cortesia

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/events/create` ou editar evento |

**Passos:**
1. Criar/editar evento pago.
2. Lote 1 (venda): nome qualquer · qty 100 · **R$ 50,00** · datas.
3. Lote 2: marcar checkbox **“Lote cortesia / gratuito”**.
4. Confirmar: preço fica **0,00** e travado; badge **Cortesia**.
5. Quantidade cortesia: ex. **50**; datas de venda do lote.
6. Nome do lote cortesia: usar nome **qualquer** (ex.: “Staff”, “Convidados”, “XYZ”) — **não** depender da palavra “CORTESIA”.
7. Salvar evento.

**Resultado esperado:**
- [ ] Evento salva com sucesso
- [ ] Lote cortesia persiste com `price = 0`
- [ ] Ao reabrir a edição, o checkbox de cortesia já vem marcado no lote R$ 0
- [ ] Preço “a partir de” na vitrine **não** usa o R$ 0 (mostra o menor lote pago)

---

### 3.2 CT-EVT-COR-002 — Negativos do lote cortesia

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Marcar cortesia e tentar mudar preço para 10,00 (campo deve estar desabilitado / forçar 0).
2. Desmarcar cortesia com preço 0,00 → sistema deve limpar/pedir preço > 0.
3. Evento só com lotes cortesia → salvar deve falhar.
4. Digitar 0,00 sem marcar cortesia → erro pedindo o checkbox.

**Resultado esperado:**
- [ ] Comportamentos acima corretos

---

### 3.3 CT-EVT-COR-003 — Acesso à tela de pacotes

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/manager/events/:eventId/cortesias` · botão na edição · lista de eventos |

**Passos:**
1. Pela edição do evento: **Enviar pacotes cortesia (Staff / convidados)**.
2. Pela lista de eventos: atalho Cortesias (se existir).
3. Abrir direto a rota do evento.

**Resultado esperado:**
- [ ] Tela “Pacotes cortesia” carrega com o título do evento
- [ ] Dropdown “Lote cortesia” lista apenas lotes com **preço 0 e estoque > 0**
- [ ] Se não houver lote R$ 0: mensagem orientando marcar “Lote cortesia / gratuito”
- [ ] Botões (Ver relatório, Criar pacote, etc.) no padrão de cores (sem fundo branco)

---

### 3.4 CT-EVT-COR-004 — Criar pacote e copiar link

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Dados de exemplo:**
- Destinatário: `João Silva`
- E-mail: e-mail real de teste (opcional, mas recomendado)
- Lote: o lote cortesia
- Quantidade: `3` (entre 1 e 50)
- Validade: `30` dias

**Passos:**
1. Preencher formulário “Novo pacote”.
2. Clicar **Criar pacote e copiar link**.
3. Conferir toast de sucesso e link copiado.
4. Pacote aparece em “Pacotes enviados” (status Ativo, 0/3 resgatados).

**Resultado esperado:**
- [ ] Pacote criado
- [ ] Link público gerado (`/cortesia/pacote?...` ou equivalente)
- [ ] Estoque disponível do lote cortesia diminui na quantidade reservada/emitida conforme regra do backend
- [ ] Relatório `/manager/reports/complimentary-bundles` lista o pacote

---

### 3.5 CT-EVT-COR-005 — Envio WhatsApp

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. No pacote criado: **Copiar WhatsApp**.
2. Colar em WhatsApp Web/app e enviar ao destinatário.
3. Destinatário abre o link da mensagem.

**Resultado esperado:**
- [ ] Mensagem contém nome, evento, quantidade e link
- [ ] Link abre a página do pacote

---

### 3.6 CT-EVT-COR-006 — Envio por e-mail

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Pré** | Pacote com e-mail preenchido |

**Passos:**
1. Clicar **Enviar e-mail**.
2. Conferir caixa de entrada (e spam) do destinatário.
3. Abrir o link do e-mail.

**Resultado esperado:**
- [ ] E-mail enviado (ou “já havia sido enviado” se reenvio)
- [ ] Status do pacote indica e-mail enviado
- [ ] Link do e-mail funciona

---

### 3.7 CT-EVT-COR-007 — Resgate do pacote pelo destinatário

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/cortesia/pacote` · `/cortesia/resgatar` |

**Passos:**
1. Abrir o link (navegador anônimo ou outra conta).
2. Se pedir login/cadastro, concluir com o e-mail do destinatário (se o pacote restringir por e-mail).
3. Aceitar/vincular o pacote (holder).
4. Resgatar/distribuir os ingressos individuais (para si e, se qty > 1, para outros).
5. Conferir ingressos em **Meus ingressos** / carteira do cliente.

**Resultado esperado:**
- [ ] Pacote marca destinatário como quem acessou
- [ ] Contadores: resgatados N/quantidade
- [ ] Cada ingresso cortesia tem QR utilizável
- [ ] Quando todos resgatados: status “Totalmente resgatado” (ou equivalente)

---

### 3.8 CT-EVT-COR-008 — Redistribuição (pacote com vários ingressos)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Criar pacote com quantidade **≥ 2**.
2. Titular resgata 1 para si e envia/atribui outro a convidado B.
3. Convidado B conclui o resgate individual (`/cortesia/resgatar` se aplicável).

**Resultado esperado:**
- [ ] Dois ingressos em contas diferentes (ou conforme regra do produto)
- [ ] Contador do pacote atualiza corretamente

---

### 3.9 CT-EVT-COR-009 — Validação na portaria (ingresso cortesia)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Gerar chave de validação do evento (entrada/saída).
2. No validador, ler QR do ingresso cortesia resgatado.
3. Registrar entrada.

**Resultado esperado:**
- [ ] Validação OK (mesmo fluxo de ingresso pago)
- [ ] Movimentação registrada
- [ ] Segunda tentativa imediata tratada (duplicidade / já entrou)

---

### 3.10 CT-EVT-COR-010 — Estoque insuficiente e cancelamento

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Tentar criar pacote com quantidade **maior** que o disponível do lote cortesia → erro de estoque.
2. Criar pacote ativo; clicar **Cancelar** no pacote (antes de resgates, se a regra permitir).
3. Confirmar status Cancelado e impacto no estoque (devolução se aplicável).
4. (Opcional) **Liberar vínculo** se o holder acessou e ainda não resgatou.

**Resultado esperado:**
- [ ] Estoque insuficiente bloqueia criação
- [ ] Cancelamento atualiza status
- [ ] Liberar vínculo permite novo acesso conforme regra

---

### 3.11 CT-EVT-COR-011 — Relatório de pacotes cortesia

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/manager/reports/complimentary-bundles` |

**Passos:**
1. Filtrar pelo evento.
2. Localizar o pacote testado.
3. Exportar CSV (se disponível).

**Resultado esperado:**
- [ ] Pacote, destinatário, qty, resgates e status corretos
- [ ] Link “Gerenciar pacotes deste evento” volta à tela de cortesias

---

## 4. Matriz de regressão (curta)

| Área | Sem cortesia | Com cortesia |
|------|:------------:|:------------:|
| Criar evento pago | CT-EVT-SEM-001 | CT-EVT-COR-001 |
| Validações de lote | CT-EVT-SEM-002 | CT-EVT-COR-002 |
| Venda online | CT-EVT-SEM-005 | CT-EVT-SEM-005 (lote pago) |
| Pacote + link | — | CT-EVT-COR-004 |
| WhatsApp | — | CT-EVT-COR-005 |
| E-mail | — | CT-EVT-COR-006 |
| Resgate | — | CT-EVT-COR-007 |
| Portaria | CT-EVT-SEM-007 | CT-EVT-COR-009 |
| Relatório cortesia | — | CT-EVT-COR-011 |

---

## 5. Evidências sugeridas (anexar no QA)

Para cada caso P0, guardar:
1. Print do formulário de lotes (com/sem checkbox cortesia)
2. Print do evento salvo / lista
3. Print do pacote criado + link (mascarar token se necessário)
4. Print do ingresso no app do convidado
5. Print da validação OK no validador
6. Print do relatório de pacotes

---

## 6. Critérios de aceite (definição de pronto)

### Sem cortesia
- [ ] Gestor cria evento pago só com lotes de venda e publica
- [ ] Cliente compra e entra no evento
- [ ] Não é obrigatório criar lote R$ 0

### Com cortesia
- [ ] Gestor marca lote como cortesia (checkbox), independente do nome
- [ ] Cria pacote, envia (copiar / WhatsApp / e-mail)
- [ ] Convidado resgata e obtém QR
- [ ] Portaria valida o ingresso cortesia
- [ ] Relatório reflete o pacote

---

## 7. Fora de escopo deste plano

- Chargeback / bloqueio de 3 chargebacks  
- Consumo por crédito EventFest / PDV  
- Upgrade de plano / mensalidade vitrine  
- App nativo validador (usa-se a PWA `/validator`)  
- Modo offline  

---

## 8. Registro de execução

| Data | Tester | Ambiente | Build/commit | Resultado geral | Observações |
|------|--------|----------|--------------|-----------------|-------------|
| | | | | | |
| | | | | | |
