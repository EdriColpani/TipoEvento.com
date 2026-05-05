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

### 2026-05-01 (Checkpoint salvo para continuidade)
- Ajustes aplicados no retorno de pagamento e financeiro:
  - normalização de tipo de notificação do MP no webhook (`payment.updated` etc.);
  - correção de validação de `applied_percentage` (aceitando `0%`);
  - conciliação automática no retorno do checkout (sem clique manual obrigatório);
  - logs/auditoria em `payment_events`.
- Ajustes aplicados nos relatórios do gestor:
  - colunas reorganizadas para visão financeira clara (`Bruto`, `% MP`, `R$ MP`, `% Comissão`, `R$ Comissão`, `Despesas`, `Líquido`);
  - totalização geral por colunas;
  - fallback para cálculo quando split ainda não consolidado;
  - proteção contra duplicidade visual de split na agregação.
- Ajustes aplicados no fluxo de pulseiras:
  - reserva imediata das pulseiras no `create-payment-preference` (`status = pending`) para evitar múltiplas compras apontando para os mesmos IDs;
  - liberação automática das reservas quando pagamento falhar/cancelar no webhook.

#### Ponto de atenção pendente (depende de deploy)
- Deploy obrigatório das funções atualizadas:
  1. `create-payment-preference`
  2. `mercadopago-webhook`
  3. `check-payment-status`
- Sem esse deploy, o comportamento antigo pode continuar aparecendo.

#### Próximo passo ao retomar
1. Executar deploy das funções.
2. Fazer 2-3 compras de teste sequenciais.
3. Validar:
   - `wristband_analytics` (reservas `pending` distintas por transação),
   - `financial_splits` (registros por transação aprovada),
   - UI do gestor (vendidas x ativas coerentes),
   - relatório financeiro (líquido não maior que bruto).

### Checkpoint – Relatório de Vendas (retomar na próxima sessão)

**Contexto:** Na tela havia inconsistência (ex.: total R$ 3,20, 1 ingresso, média R$ 0,80). A view `sales_reports_view` não existe nas migrações do repo; o relatório foi refeito em código.

**Implementado:**

- Hook `src/hooks/use-sales-report.tsx`: agrega `receivables` com critério “pago” alinhado ao financeiro (`status = paid` ou `payment_status` em `approved` / `authorized`); gestor escopado por `manager_user_id`; admin master vê tudo; filtros por evento e `created_at` (início/fim do dia UTC).
- Contagem de ingressos: `wristband_analytics_ids.length`, com **fallback 1** se o array vier vazio (evita média errada quando o backend não preenche analytics).
- `average_ticket_price` por evento = `total_sales_value / total_tickets_sold`.
- `src/pages/SalesReports.tsx`: usa o hook, `useProfile` + acesso tipos 1/2, eventos via `useManagerEvents`, terceiro card de **média ponderada** no resumo, textos explicando base em recebíveis pagos.
- Query habilitada com `canAccess && (isAdminMaster || !!userId)` para não bloquear admin enquanto `userId` carrega.

**Build:** `npm run build` OK após as alterações.

**Para continuar amanhã:**

1. Validar em ambiente real várias compras (1 vs N ingressos no mesmo recebível; array preenchido vs vazio).
2. Decidir produto: manter fallback **1** quando `wristband_analytics_ids` está vazio ou alinhar 100% ao relatório financeiro (só tamanho do array, podendo dar 0 ingressos).
3. Confirmar RLS em `receivables` / `events` para gestor.
4. Se necessário, alinhar critérios entre relatório de vendas e relatório financeiro linha a linha.

### Checkpoint – Branding e UI (retomar na próxima sessão)

**Contexto:** Foi iniciado o ajuste visual do sistema com nova identidade da marca e correções de usabilidade no menu.

**Diretriz validada do cliente (não alterar):**
- Nome oficial do sistema: **EventFest**.
- Logo oficial: PNG enviado pelo cliente (arquivo em uso: `public/logo-eventfest.png`).

**Implementado:**
- Landing/header usando a logo PNG oficial.
- Ajustes de tamanho da logo para maior visibilidade.
- Troca de paleta visual para tons da identidade EF (ciano/azul) aplicada de forma ampla no sistema.
- Correção do bug de menu: texto sumia ao passar o mouse no dropdown; corrigido no componente base `src/components/ui/dropdown-menu.tsx` para manter contraste no hover/focus.
- Ajustes no texto do rodapé da landing conforme solicitado anteriormente.

**Build e qualidade:**
- `npm run build` executado com sucesso após os ajustes.
- Sem erros de lint nos arquivos principais alterados.

**Pendências para retomar:**
1. Revisão visual final tela a tela (gestor/admin/cliente) para confirmar contraste e legibilidade após a paleta global.
2. Validar com o cliente se mantém a paleta EF global ou se deseja escopo apenas em áreas específicas.
3. Se aprovado, consolidar tokens de tema (semânticos) para reduzir dependência de classes utilitárias legadas.

