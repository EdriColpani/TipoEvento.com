# PROMPT — Integração Gestor no EventFest Rush (App Único)

> **Uso:** copie este documento integralmente no chat do projeto mobile **já existente** (EventFest Rush / app do cliente).
> **Objetivo:** transformar o app em **EventFest** unificado — **Modo Cliente** + **Modo Gestor** no mesmo binário, com rotas e menus definidos pelo login (`tipo_usuario`).
> **Backend:** mesmo Supabase do web EventFest (`tipoevento`).
> **Fora deste escopo:** app **EventFest Validator** (portaria) permanece separado.

---

## Decisão de produto (obrigatória)

1. **Não criar** um segundo app só para gestor.
2. **Estender** o app do cliente existente com um **modo Gestor**.
3. Após login, decidir o shell de navegação:
   - `tipo_usuario_id === 3` (cliente) → shell Cliente
   - `tipo_usuario_id === 2` (gestor/promotor) → shell Gestor
   - `tipo_usuario_id === 1` (Admin Master) → shell Gestor com bypass de plano onde o web permite; **sem** painel admin global da plataforma
4. Usuário que é gestor **e** também compra ingresso: oferecer **troca de modo** (Cliente ↔ Gestor) no Perfil / Mais, sem novo login.
5. Conta sem papel adequado para a área: mensagem clara + CTA (ex.: “Sua conta é de cliente; para operar eventos, complete cadastro de gestor” ou o inverso).

---

## Contexto técnico

- Stack atual do app: **Expo + TypeScript + Supabase + React Query + React Navigation**.
- Reutilizar auth, Secure Store, tema escuro, toasts, deep links já existentes.
- Tema gestor: manter identidade EventFest (**escuro + amarelo/dourado**). Botões: primário `amarelo + texto preto`; outline com fundo escuro (nunca outline claro ilegível).
- Espelhar regras do web em `tipoevento` (não inventar APIs novas sem necessidade).
- Preferir **REST/RPC com timeout** (padrão do web recente) em vez de queries supabase-js que possam travar a UI.

---

## Arquitetura de navegação (alvo)

```
Auth Stack (comum)
  → Login / Cadastro / Recuperar senha
  → Pós-login: resolver tipo_usuario → RootSwitcher

RootSwitcher
  → ClientTabs (modo cliente)
  → ManagerTabs (modo gestor)
  → (opcional) seletor de modo se usuário tiver ambos os contextos

ClientTabs (já existente — preservar e evoluir)
  Tab: Home / Eventos
  Tab: Ingressos
  Tab: Carteira
  Tab: Perfil
    → Trocar para Modo Gestor (se tipo 1 ou 2)

ManagerTabs (NOVO)
  Tab: Início (Dashboard)
  Tab: Eventos
  Tab: Relatórios
  Tab: Mais
    → Chaves de validação
    → Créditos / estabelecimentos / PDV (se plano)
    → Notificações
    → Perfil PF / Empresa
    → Plano e cobranças
    → Trocar para Modo Cliente
    → Sair
```

Stacks aninhadas no gestor:

```
Eventos
  → Lista
  → Detalhe
  → Criar / Editar (simplificado)
  → Ingressos (lotes)
  → Cortesias
  → Banners

Relatórios
  → Hub
  → Vendas / Financeiro / Eventos / Público / Portaria / Inscrições / Cortesias
  → Créditos (spends / accounting) se plano
  → Mensalidade vitrine / Licença consumo

Mais
  → Chaves de validação
  → Estabelecimentos crédito
  → PDV (operacional; se fizer sentido no mobile)
  → Operadores PDV
  → Liquidações de crédito
  → Configurações / Pagamento MP (webview se OAuth complexo)
```

---

## Autenticação e onboarding (integração)

### Login (já existe — ajustar)
- Mesmo e-mail/senha Supabase.
- Após `getSession` / perfil: ler `profiles.tipo_usuario_id`.
- Persistir `activeMode: 'client' | 'manager'` no Secure Store (default pelo tipo).
- Logout limpa sessão + modo.

### Cadastro
- Manter cadastro **cliente**.
- Adicionar fluxo **gestor** (PF → opcional PJ), alinhado ao web:
  - Conta promotor
  - Perfil individual
  - Empresa (CNPJ, endereço completo — usado também no mapa da rede de crédito)
  - Aceite de contrato / termos
  - Gate de billing/plano (`isCompanyBillingReady` / regras de `manager-billing-gate`)

### Gates (espelhar web)
- Cadastro incompleto → banner + bloqueio de escrita.
- Plano inativo / inadimplente → leitura permitida quando o web permitir; escrita bloqueada; CTA para regularizar.
- `plan_features` / features do plano: esconder ou cadeado + CTA (`dashboard`, `events`, `events_create`, `wristbands`, `validation_keys`, `reports_*`, créditos, etc.).
- Evento `listing_only`: sem venda de ingressos; só vitrine/inscrição.
- Gestor PF sem empresa: limitar conforme regra do web.

---

## Modo Cliente — preservar e completar (o que já faz sentido)

Manter tudo do Rush que já estiver pronto. Garantir / incluir:

### Carteira EventFest
- Saldo, recarga, extrato, QR no PDV.
- Card **Onde usar seu crédito** via RPC `list_credit_acceptance_network`.
- Botão **Mapa / Como chegar** em estabelecimentos (e eventos, se fizer sentido):
  1. Pedir geolocalização do cliente.
  2. Abrir Google Maps com rota: origem = GPS; destino = endereço cadastrado.
  3. Prioridade do destino: `address_lat/lng` → `address` → `location` (só se não houver `address`).
  4. **Nunca** usar nome do estabelecimento + empresa como destino.
  5. Sem endereço → toast; não abrir Maps.
- Refresh da rede após voltar do background / pull-to-refresh.

### Demais (cliente)
- Vitrine, detalhe, compra, ingressos/QR, inscrição gratuita, perfil, notificações de compra.
- Deep links de retorno MP.

---

## Modo Gestor — Fase 1 (MVP) — integrar agora

### 1. Dashboard
- Cards: vendas hoje / semana / mês.
- Ingressos vendidos vs capacidade (eventos ativos).
- Receita líquida estimada (se plano permitir).
- Gráfico simples 7 ou 30 dias.
- Alertas: estoque baixo (&lt;10%), evento sem ingresso, pagamento pendente, reaceite de contrato.
- Eventos próximos (7 dias).
- Atalhos: criar evento, vendas, gerar chave de validação.

### 2. Eventos
- Lista (filtros: ativos, rascunho, passados) + busca título/cidade.
- Card: imagem, título, data, local, status, % vendido.
- Detalhe: capacidade, lotes, publicação.
- Ações: ativar/desativar, compartilhar link público.
- **Criar/editar simplificado:** título, descrição curta, categoria, data/hora, local/endereço (com geo se possível), capacidade, capa, vitrine vs venda, rascunho/publicar.
- Edição avançada completa: pode abrir **WebView** do painel web se o wizard for grande demais.

### 3. Ingressos (pulseiras / lotes)
- Lista por evento.
- Criar lote: nome, tipo de acesso, preço, quantidade.
- Vendidos / disponíveis / reservados.
- Pausar venda; alerta de estoque crítico.
- Respeitar regras de inventário (counter / unit) do backend.

### 4. Chaves de validação (gestão — não validar)
- Listar por evento; criar (nome equipe, evento, validade).
- Exibir chave **uma vez** (copiar / WhatsApp).
- Revogar/desativar; status e último uso.
- Texto fixo: equipe usa o app **EventFest Validator**, não este.

### 5. Notificações
- Push: estoque baixo, chave expirando, contato/admin, (opcional) nova venda.
- Inbox in-app + preferências por tipo.

### 6. Configurações / Perfis
- Perfil PF e perfil empresa (endereço completo — CEP, rua, número, bairro, cidade, UF).
- Dados de pagamento/recebimento (WebView OAuth MP se complexo).
- Plano e cobranças (status + link para quitar).
- Versão, suporte, termos, sair.
- Trocar modo Cliente ↔ Gestor.

---

## Modo Gestor — Fase 2

### 7. Relatórios (mobile)
- Vendas, eventos/ocupação, financeiro resumido (bruto/comissão/líquido).
- Público (demografia básica), inscrições gratuitas.
- Movimentação de ingressos (quase realtime da portaria).
- Cortesias emitidas/utilizadas.
- Export PDF/Excel: WebView ou share de arquivo gerado no backend.

### 8. Cortesias
- Pacotes por evento, quantidade, link/código, acompanhamento de resgates.

### 9. Banners de evento
- Listar / criar / editar (imagem, link, evento, ordem, ativo) + preview.

### 10. Créditos (se plano habilitar)
- Estabelecimentos (nome, endereço para mapa do cliente, vínculo evento, ativo, aceite crédito).
- Catálogo de produtos (se couber no mobile).
- PDV: visão operacional ou atalho; operadores PDV.
- Relatórios de consumo; liquidações pendentes (D+1 manual — alinhado ao web).
- **Não** implementar validação de portaria aqui.

### 11. Mensalidade e licenças
- Faturas listing monthly; licença de consumo; status e CTA de pagamento.

---

## Modo Gestor — Fase 3 (opcional / WebView)

- Checklist go-live completo.
- Wizard completo de evento (todos os passos web).
- Observabilidade de fila de checkout.
- Histórico de alterações de configuração.
- Multi-usuários da empresa (quando existir no backend).
- Biometria para abrir o app; widgets.

---

## APIs e espelhamento do web (`tipoevento`)

### Auth / perfil
- Supabase Auth; `profiles`; `tipo_usuario_id`.
- Escopo empresa: `user_companies`, company primary do gestor.

### Cliente
- `get_public_vitrine_events`, `get_event_ticket_availability`, checkout MP.
- `get_client_credit_balance`, `get_credit_wallet_status`, `list_credit_ledger`, `list_credit_acceptance_network`.
- Carteira: QR / intents conforme web.

### Gestor (hooks/RPCs equivalentes)
- Eventos: escopo gestor (`fetchEventsVisibleToGestor` / REST equivalente).
- Dashboard / gráficos de vendas.
- Wristbands / disponibilidade.
- `validation_api_keys` (criar/listar/revogar).
- Notificações do gestor.
- Billing: `company_billing`, `plan_features`, gates de mensalidade/licença.
- Créditos: `list_company_credit_establishments`, `save_credit_establishment` (com `address`, `address_lat`, `address_lng`), PDV, settlements.
- Relatórios: vendas, financeiro, público, movimentação, cortesias, credit spends/accounting.

### Tabelas principais
`profiles`, `companies`, `events`, `wristbands`, `wristband_analytics`, `validation_api_keys`, `receivables`, `company_billing`, `plan_features` / features, `credit_establishments`, `credit_*`, bundles de cortesia, banners.

### Edge Functions
- Checkout / OAuth MP: preferir WebView quando o fluxo for pesado.
- **Não** usar endpoint de validação de ingresso da portaria no modo gestor do dia a dia.

---

## Regras de negócio (checklist)

1. RLS do Supabase: gestor só vê dados do seu escopo; Admin Master conforme web.
2. Features por plano antes de exibir menu.
3. Inadimplência: espelhar `ManagerLayout` / `manager-billing-gate`.
4. `listing_only` sem checkout pago.
5. Chave de validação: mostrar uma vez; não persistir plain text após compartilhar.
6. Mapa da carteira do cliente: só endereço real (nunca nome fantasia).
7. Endereço da empresa alimenta fallback da rede de aceite no backend — manter cadastro de endereço completo no perfil PJ.
8. Operador PDV (`pdv_operator`): menus reduzidos (estabelecimentos/produtos/PDV), sem gestão estrutural se o web restringir.

---

## UX e não funcionais

- Offline: cache stale-while-revalidate em dashboard e listas.
- Pull-to-refresh; skeletons; nunca spinner infinito sem timeout.
- Toasts de sucesso/erro; timeouts em rede (8–15s) com retry.
- Touch ≥ 44pt; contraste AA; pt-BR.
- Listas paginadas (≈20).
- Troca de modo sem perder sessão.
- Deep links: eventos públicos, retorno pagamento, abrir modo gestor se autenticado.

---

## Segurança

- Tokens só em Secure Store.
- Sem dados de outros gestores (RLS).
- Logout se conta desativada.
- Não embutir Admin Master global (planos da plataforma, backup DB, todas as empresas).
- Certificate pinning opcional (fase 3).

---

## Fora de escopo (explícito)

- App **EventFest Validator** (escanear QR na portaria).
- Painel Admin Master completo da plataforma.
- Carrossel da home pública global / modo pré-lançamento admin.
- Criar um segundo app “EventFest Manager” separado.

---

## Plano de implementação sugerido (no app existente)

### Fase A — Fundação
1. `RootSwitcher` + `activeMode` + troca de modo.
2. Shell `ManagerTabs` vazio com placeholders e gate de plano.
3. Cadastro/perfil gestor mínimo + company profile (endereço).

### Fase B — MVP operacional
4. Dashboard.
5. Eventos lista/criar/editar simplificado.
6. Lotes de ingressos.
7. Chaves de validação.
8. Notificações básicas.

### Fase C — Cliente carteira (se ainda faltar)
9. Rede de aceite + botão Mapa com endereço (spec acima).

### Fase D — Fase 2
10. Relatórios, cortesias, banners, créditos/PDV/liquidações, cobranças.

### Fase E
11. WebViews para fluxos pesados; biometria; polish.

---

## Critérios de aceite

### App único
- [ ] Um único install na loja; login único.
- [ ] Cliente e gestor veem shells diferentes conforme tipo / modo.
- [ ] Troca de modo funciona sem relogar (quando aplicável).
- [ ] Conta no modo errado recebe mensagem clara (não “erro genérico”).

### Cliente
- [ ] Compra / ingressos / carteira continuam funcionando.
- [ ] Mapa da rede usa endereço cadastrado, não o nome do PDV.

### Gestor MVP
- [ ] Dashboard com dados reais.
- [ ] Lista e cria evento simplificado.
- [ ] Cria lote e vê estoque.
- [ ] Gera e compartilha chave de validação.
- [ ] Respeita bloqueio de plano.
- [ ] Perfil empresa com endereço salvável (sem travar UI).

### Build
- [ ] iOS + Android via Expo EAS no mesmo projeto.

---

## Prompt final para a IA (copiar no projeto do app)

```
Integre o MODO GESTOR no app EventFest Rush já existente (Expo + TypeScript + Supabase),
seguindo o documento PROMPT_EVENTFEST_RUSH_GESTOR_INTEGRATION.md na íntegra.

Regras:
- NÃO criar um segundo app Manager.
- Um binário só: Modo Cliente + Modo Gestor com rotas/menus pelo login (tipo_usuario) e troca de modo.
- Validador de portaria continua FORA (app Validator separado).
- Reutilize auth, React Query, tema escuro + amarelo, Secure Store.
- Espelhe APIs/RPCs/gates do backend web tipoevento.
- Priorize Fase A + Fase B (MVP gestor) sem quebrar o fluxo do cliente.
- Inclua/garanta na carteira do cliente: list_credit_acceptance_network + botão Mapa
  com destino = endereço cadastrado (nunca nome do estabelecimento).
- Queries/RPC com timeout; sem spinner infinito.
- Admin Master global da plataforma NÃO entra neste app.
```

---

## Referências no monorepo web (`tipoevento`)

- Prompts irmãos: `docs/mobile-apps/PROMPT_EVENTFEST_RUSH.md`, `PROMPT_EVENTFEST_MANAGER.md` (histórico; preferir este doc de integração), `PROMPT_EVENTFEST_VALIDATOR.md`
- Rotas gestor web: `src/App.tsx` (`/manager/*`)
- Gates: `src/constants/manager-billing-gate.ts`, `ManagerLayout`
- Carteira / rede / mapa: `ClientCreditWallet`, `use-credit-wallet-phase2`, `list_credit_acceptance_network`, `google-maps.ts`
- Estabelecimentos: `ManagerCreditEstablishments`, `save_credit_establishment`
