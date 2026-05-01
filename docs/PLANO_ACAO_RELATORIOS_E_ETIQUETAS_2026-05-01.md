# Plano de Ação - Relatórios e Etiquetas (2026-05-01)

## Objetivo

Corrigir por partes, com previsibilidade e rastreio, os problemas reportados em:

1. Relatórios da área do **Gestor** (prioridade 1);
2. Relatórios da área do **Administrador Global** (prioridade 2);
3. Fluxo de **etiquetas/pulseiras** pós-pagamento (status, reserva, impressão).

> Regra de execução: só avançar de fase após validação da fase anterior.

---

## Governança de execução

- Cada fase terá:
  - escopo fechado;
  - entregáveis técnicos;
  - critérios de aceite funcionais;
  - status (`Pendente`, `Em andamento`, `Concluída`, `Bloqueada`).
- Ao final de cada fase, registrar:
  - o que foi feito;
  - o que foi validado;
  - pendências remanescentes.

---

## Fase 1 - Diagnóstico dos relatórios do Gestor

**Status:** Em andamento

### Escopo
- Mapear todas as métricas e tabelas da área de relatório do gestor:
  - fonte dos dados;
  - filtros aplicados (status, período, escopo por `manager_user_id`);
  - divergências entre esperado x atual.

### Entregáveis
- Matriz de diagnóstico por widget/relatório (origem, regra, erro encontrado).
- Lista priorizada de correções do gestor.

### Critérios de aceite
- Cada bloco do relatório do gestor tem:
  - regra de cálculo documentada;
  - query/fonte identificada;
  - problema reproduzível descrito.

---

## Fase 2 - Correções dos relatórios do Gestor

**Status:** Pendente

### Escopo
- Corrigir cálculos, filtros e agregações dos relatórios do gestor.
- Garantir consistência entre:
  - transações;
  - financeiro;
  - ingressos vendidos;
  - taxa/comissão.

### Entregáveis
- Ajustes de hooks/queries/tabelas de relatório do gestor.
- Padronização de status aceitos em métricas financeiras (`paid`, `approved`, `authorized`, conforme regra aprovada).

### Critérios de aceite
- Dashboard e relatórios do gestor batem com dados de transações reais.
- Teste de regressão com pelo menos 3 cenários:
  - pendente,
  - aprovado,
  - falho/cancelado.

---

## Fase 3 - Diagnóstico e correções da área Administrador Global

**Status:** Pendente

### Escopo
- Repetir matriz de diagnóstico para visão global (cross-gestor).
- Corrigir agregações globais e evitar dupla contagem.

### Entregáveis
- Correções dos relatórios globais.
- Validação de coerência entre visão gestor e visão global.

### Critérios de aceite
- Valores globais = soma consistente das visões válidas por gestor (respeitando regras de status).

---

## Fase 4 - Fluxo de etiquetas/pulseiras e impressão

**Status:** Pendente

### Escopo
- Definir e implementar a máquina de estados do pós-pagamento:
  - compra aprovada;
  - pulseira reservada/atribuída;
  - aguardando impressão;
  - impressa/entregue (se aplicável).
- Corrigir inconsistência de “todas disponíveis para venda” após compra aprovada.

### Entregáveis
- Regra técnica documentada: quando sai de disponível -> reservado -> atribuído -> impressão.
- Ajustes de backend/frontend para refletir status real.

### Critérios de aceite
- Após pagamento aprovado, item não aparece como “disponível para nova venda”.
- Status “aguardando impressão” tem gatilho e origem claramente definidos.

---

## Fase 5 - Testes finais integrados + checklist de produção

**Status:** Pendente

### Escopo
- Teste integrado gestor + admin + cliente.
- Verificação de reconciliação, relatórios e etiquetas.

### Entregáveis
- Checklist final assinado por cenário.
- Lista de riscos residuais (se houver).

### Critérios de aceite
- Sem divergências críticas entre:
  - dados de pagamento;
  - dados de ingressos/pulseiras;
  - dados de relatórios.

---

## Backlog de validação (a preencher por fase)

- [ ] Gestor: Vendas totais
- [ ] Gestor: Ingressos vendidos
- [ ] Gestor: Receita mensal
- [ ] Gestor: Eventos mais vendidos
- [ ] Gestor: Vendas recentes
- [ ] Admin global: consolidação financeira
- [ ] Admin global: ranking/eventos
- [ ] Etiquetas: disponibilidade pós-pagamento
- [ ] Etiquetas: status de impressão

---

## Log de progresso

### 2026-05-01
- Plano criado.
- Próximo passo: concluir diagnóstico detalhado da Fase 1 (relatórios do gestor).

### 2026-05-01 (Rodada 1 - Gestor: diagnóstico + ajustes iniciais)
- Diagnóstico identificado:
  1. Parte dos relatórios ainda considerava apenas `status='paid'` (ignorando `payment_status='approved/authorized'`).
  2. Parte dos relatórios não filtrava por `manager_user_id` (misturava escopo global no gestor).
  3. Cards da dashboard zeravam no início do mês por janela mensal rígida.
  4. Hook de "Eventos mais vendidos" dependia de agregação antiga e podia divergir.
- Ajustes aplicados:
  - Dashboard gestor:
    - filtros paid-like (`paid`, `approved`, `authorized`);
    - escopo por gestor/admin;
    - comparação alterada para janela móvel (30 dias vs 30 dias anteriores).
  - Receita mensal e vendas recentes:
    - escopo por gestor/admin;
    - filtros paid-like.
  - Eventos mais vendidos:
    - cálculo refeito por agregação direta em `receivables` + `wristbands/wristband_analytics`.
  - Relatório financeiro do gestor:
    - escopo por gestor/admin;
    - filtros paid-like.
- Pendências para fechar Fase 1:
  - validação funcional em tela com usuário gestor real;
  - matriz final "widget x valor esperado x valor exibido";
  - ajustes finos em widgets que ainda divergirem após teste de campo.

