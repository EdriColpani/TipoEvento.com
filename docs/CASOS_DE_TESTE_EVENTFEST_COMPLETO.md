# Casos de teste completos — EventFest

**Atualizado:** 2026-07-16  
**Versão do documento:** 1.0  
**Objetivo:** cobrir de ponta a ponta os fluxos de negócio da plataforma EventFest para homologação, regressão e go-live.

**Relacionado:**
- [CHECKLIST_QA_GO_LIVE_30MIN.md](./CHECKLIST_QA_GO_LIVE_30MIN.md) — smoke rápido
- [CHECKLIST_HOMOLOGACAO_CREDITOS.md](./CHECKLIST_HOMOLOGACAO_CREDITOS.md) — créditos E2E
- [EMPRESA_PARCEIRA.md](./EMPRESA_PARCEIRA.md) — parceiros consumo
- [CHECKLIST_TESTES_ANTI_FRAUDE.md](./CHECKLIST_TESTES_ANTI_FRAUDE.md) — inatividade ingressos
- [.cursor/rules/ticket-only-chargeback.mdc](../.cursor/rules/ticket-only-chargeback.mdc) — chargeback ingresso

**Legenda de prioridade**

| Sigla | Significado |
|-------|-------------|
| **P0** | Bloqueia go-live se falhar |
| **P1** | Funcionalidade core; corrigir antes de release |
| **P2** | Importante, mas pode ir em hotfix pós-release |

**Legenda de status**

`[ ]` pendente · `[x]` OK · `[!]` falhou (anotar tela, hora, print, console)

---

## 1. Escopo e notas importantes

### 1.1 O que este documento cobre

| Área solicitada | Seção |
|-----------------|-------|
| Validação e cadastro de empresa + e-mail | §2 |
| Adesão e pagamento dos 4 planos + empresa parceira | §3 |
| Cadastro de eventos | §4 |
| Validação de ingressos e chaves de acesso | §5 |
| Cadastro cliente web (PWA responsiva) | §6 |
| Landing page, eventos visíveis e filtros | §7 |
| Compra ingressos Mercado Pago | §8 |
| Rotas de transferência ingresso → gestor / EventFest | §9 |
| Meus ingressos e dados pessoais | §10 |
| Carteira, recarga, histórico | §11 |
| Compra ingresso com carteira + repasse D+1 | §12 |
| Acesso gestor web/PWA | §13 |
| Todos os relatórios do gestor | §14 |
| **Complementos identificados no sistema** | §15–§17 |

### 1.2 App nativo vs web

O EventFest **não possui app nativo** (App Store / Play Store) no repositório atual. Cliente e gestor usam **PWA web responsiva** no navegador. Apps móveis separados (validador, gestor Rush) estão documentados em `docs/mobile-apps/` como integrações futuras ou externas.

Para testes “app”, usar:
- **Desktop:** Chrome/Edge
- **Mobile:** Chrome Android / Safari iOS ou DevTools modo responsivo
- **PWA:** instalar carteira conforme [WALLET_INSTALAR_CELULAR.md](./WALLET_INSTALAR_CELULAR.md)

### 1.3 Planos comerciais (referência)

| Código | Nome | Venda ingressos | Consumo crédito | Mensalidade |
|--------|------|:---:|:---:|:---:|
| `listing_monthly` | Divulgação / vitrine | — | — | Sim (MP) |
| `ticket_commission` | % sobre ingressos | Sim | Opcional* | — |
| `ticket_plus_consumption` | Ingresso + consumo | Sim | Sim | — |
| `consumption_or_license` | Consumo / licença | — | Sim (pós-licença) | Licença MP |
| **Empresa parceira** (`company_kind: partner`) | Só consumo na rede | — | Sim | Licença MP |

\*Módulo consumo em `ticket_commission` depende de `consumption_module_enabled` no admin.

---

## 2. Pré-requisitos e ambiente

### 2.1 Ambiente

- [ ] Homologação espelhando produção **ou** produção com contas de teste
- [ ] Migrations Supabase aplicadas (`supabase db push` sem erro)
- [ ] Edge Functions críticas deployadas (MP webhook, checkout, validate-ticket, credit-spend)
- [ ] `SITE_URL` e webhook Mercado Pago configurados
- [ ] Modo pré-lançamento definido (`preview` ou `live`) em `/admin/settings/public-launch`

### 2.2 Contas de teste sugeridas

| Persona | Papel | Uso |
|---------|-------|-----|
| `cliente+qa@...` | Cliente (`tipo_usuario_id = 3`) | Compras, carteira, ingressos |
| `gestor-vitrine@...` | Gestor plano divulgação | Eventos gratuitos, inscrições |
| `gestor-ingresso@...` | Gestor plano ingressos | Lotes, MP OAuth, validação |
| `gestor-hibrido@...` | Gestor ingresso + consumo | Carteira no evento, PDV |
| `gestor-licenca@...` | Gestor consumo/licença | Licença mensal, estabelecimentos |
| `parceiro@...` | Empresa parceira | PDV cross-evento |
| `admin@...` | Admin Master | Configurações, relatórios rede |
| `operador-pdv@...` | Operador PDV | Menu restrito |

### 2.3 Dados auxiliares

- CNPJ/CPF de homologação válidos
- Cartão de teste Mercado Pago (sandbox ou produção conforme ambiente)
- Evento futuro com lotes ativos e evento passado para status “Encerrado”
- Chave PIX de chargeback configurada em `/admin/settings/ticket-chargeback-pix`

---

## 3. Cadastro, autenticação e empresa

### CT-AUTH-001 — Cadastro cliente com confirmação de e-mail

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/register` |

**Pré-condições:** e-mail novo não cadastrado.

**Passos:**
1. Acessar `/register`
2. Preencher nome, e-mail, CPF, gênero, senha
3. Submeter cadastro
4. Abrir e-mail de confirmação (Resend / Supabase)
5. Clicar no link de confirmação
6. Fazer login em `/login`

**Resultado esperado:**
- [ ] Tela de confirmação de e-mail exibida após cadastro
- [ ] Link confirma conta; login bem-sucedido
- [ ] Redirecionamento para vitrine `/` (cliente logado)
- [ ] Sem loop Login ↔ Avatar no header

---

### CT-AUTH-002 — Recuperação de senha

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rotas** | `/forgot-password`, `/reset-password` |

**Passos:**
1. Em `/login`, clicar “Esqueci minha senha”
2. Informar e-mail cadastrado
3. Abrir e-mail e seguir link
4. Definir nova senha em `/reset-password`
5. Login com nova senha

**Resultado esperado:**
- [ ] E-mail recebido em tempo razoável (< 2 min)
- [ ] Nova senha aceita; sessão anterior invalidada se aplicável

---

### CT-AUTH-003 — Cold boot de sessão (primeiro acesso do dia)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Referência** | `.cursor/rules/auth-cold-boot-session.mdc` |

**Pré-condições:** JWT expirado no `localStorage` de sessão anterior.

**Passos:**
1. Abrir site sem limpar cache manualmente (simular “amanhã”)
2. Observar header (Login vs Avatar)
3. Se redirecionado a `/login`, tentar login normal

**Resultado esperado:**
- [ ] Header **estável** — sem piscar Login ↔ Avatar
- [ ] Sessão expirada → `/login` limpo, sem usuário fantasma
- [ ] Sessão válida → redirect automático ao painel correto
- [ ] Um 401/403 isolado no boot é aceitável; **loop contínuo** é falha

---

### CT-GESTOR-001 — Cadastro gestor: conta + verificação de e-mail

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/manager/register/account`, `/manager/register` |

**Passos:**
1. Criar conta em `/manager/register/account`
2. Confirmar e-mail
3. Login e acesso a `/manager/register`
4. Aceitar contrato de adesão da plataforma

**Resultado esperado:**
- [ ] E-mail de confirmação recebido
- [ ] Contrato exibido integralmente; aceite registrado
- [ ] Assistente de perfil (PF/PJ / parceiro) disponível

---

### CT-GESTOR-002 — Cadastro empresa PJ (organizador)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/register/company` |

**Passos:**
1. Escolher “Organizador de eventos” no assistente
2. Preencher CNPJ, razão social, endereço
3. Salvar empresa

**Resultado esperado:**
- [ ] Empresa criada e vinculada ao usuário como dono
- [ ] Redirecionamento para configurações / escolha de plano
- [ ] Menu gestor parcialmente bloqueado até aceite de plano

---

### CT-GESTOR-003 — Cadastro gestor PF (pessoa física)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/manager/register` (dialog PF) |

**Passos:**
1. No assistente, escolher promotor pessoa física
2. Preencher CPF e dados obrigatórios
3. Concluir cadastro

**Resultado esperado:**
- [ ] Empresa PF criada (`company_kind` adequado)
- [ ] Fluxo de plano igual ao PJ

---

### CT-GESTOR-004 — Convite de membro / operador PDV

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/manager/settings/pdv-operators` |

**Passos:**
1. Dono da empresa convida operador PDV por e-mail
2. Operador aceita convite (`accept_company_member_invites`)
3. Operador faz login

**Resultado esperado:**
- [ ] Operador vê apenas PDV, estabelecimentos e perfil individual
- [ ] Operador **não** acessa eventos, relatórios financeiros ou configurações sensíveis

---

## 4. Planos comerciais e adesão

### CT-PLAN-001 — Plano divulgação (`listing_monthly`)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/settings/company-profile?tab=billing` |

**Passos:**
1. Selecionar plano “Mensalidade — divulgação”
2. Ler e aceitar contrato do plano
3. Pagar mensalidade via Mercado Pago (`create-listing-monthly-checkout`)
4. Verificar `listing_active_until` atualizado

**Resultado esperado:**
- [ ] Menu: eventos, inscrições, banners, relatório inscrições/público
- [ ] Menu **sem**: pulseiras, chaves validação, relatórios financeiros/vendas
- [ ] Evento pode ser criado em modo vitrine / inscrição gratuita
- [ ] Checkout de ingressos pagos **bloqueado** na página pública

---

### CT-PLAN-002 — Plano % ingressos (`ticket_commission`)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Selecionar e aceitar plano
2. Conectar Mercado Pago OAuth em Perfil da Empresa → Pagamentos
3. Criar evento pago com lotes mínimos exigidos pelo plano
4. Publicar evento (go-live)

**Resultado esperado:**
- [ ] Pulseiras, chaves, relatórios financeiros/vendas habilitados
- [ ] Comissão aplicada por faixa de volume (`ensure_event_applied_percentage`)
- [ ] Split MP: gestor + EventFest (`financial_splits`)

---

### CT-PLAN-003 — Plano ingresso + consumo (`ticket_plus_consumption`)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Aceitar plano híbrido
2. Admin libera módulo consumo se necessário
3. Configurar estabelecimento e PDV
4. No evento, habilitar “Consumo com crédito EventFest”

**Resultado esperado:**
- [ ] Cliente pode pagar ingresso com carteira no checkout
- [ ] PDV aceita QR da carteira no evento
- [ ] Relatórios de consumo e repasses D+1 disponíveis

---

### CT-PLAN-004 — Plano consumo / licença (`consumption_or_license`)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Aceitar plano
2. Pagar licença mensal (`create-consumption-license-checkout`)
3. Tentar PDV **antes** e **depois** do pagamento

**Resultado esperado:**
- [ ] Antes do pagamento: módulo consumo bloqueado
- [ ] Após pagamento: estabelecimentos e PDV liberados
- [ ] Sem venda de ingressos pagos pela plataforma

---

### CT-PLAN-005 — Empresa parceira (somente consumo)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rotas** | `/admin/settings/partner-companies/create`, `/manager/register` |

**Cenários:**

**A — Admin cria parceiro**
1. Admin Master cria empresa parceira + convida dono
2. Dono define senha e paga licença

**B — Autoatendimento parceiro**
1. Usuário escolhe “Empresa parceira (consumo)” no cadastro
2. Segue fluxo em [EMPRESA_PARCEIRA.md](./EMPRESA_PARCEIRA.md)

**Resultado esperado:**
- [ ] `company_kind = partner`
- [ ] Menu **sem** eventos pagos, pulseiras, chaves validação
- [ ] PDV e estabelecimentos funcionais após licença
- [ ] Pode vincular estabelecimento a evento de outro produtor (cross)

---

### CT-PLAN-006 — Upgrade de plano e reaceite de contrato

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Gestor solicita upgrade (ex.: vitrine → ingressos)
2. Admin aprova ou gestor confirma novo plano
3. Sistema exige reaceite se `requires_billing_reacceptance`

**Resultado esperado:**
- [ ] Novo contrato com hash/version snapshot
- [ ] Menu atualizado conforme novo plano
- [ ] Auditoria visível em `/manager/reports/admin-contract-acceptances` (admin)

---

### CT-PLAN-007 — Inadimplência mensalidade divulgação

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Deixar `listing_active_until` expirado
2. Tentar criar evento / operar painel

**Resultado esperado:**
- [ ] Operações bloqueadas exceto renovação/pagamento
- [ ] Banner ou redirect claro para regularizar

---

### CT-PLAN-008 — Taxa de inatividade venda de ingressos

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Referência** | [CHECKLIST_TESTES_ANTI_FRAUDE.md](./CHECKLIST_TESTES_ANTI_FRAUDE.md) |

**Passos:**
1. Simular mês sem vendas em plano com ingressos
2. Verificar cobrança `create-ticket-inactivity-checkout`
3. Ignorar pagamento até auto-desativação

**Resultado esperado:**
- [ ] Cobrança gerada conforme regra admin
- [ ] `ticket_inactivity_blocked` impede criar/reativar eventos
- [ ] Pagamento libera operação

---

## 5. Eventos — cadastro, publicação e ciclo de vida

### CT-EVT-001 — Criar evento vitrine (inscrição gratuita)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/events/create` |

**Passos:**
1. Preencher título, data, local, categoria, imagens
2. Marcar evento como gratuito / inscrição
3. Configurar turmas e capacidade (se aplicável)
4. Salvar e ativar

**Resultado esperado:**
- [ ] Evento aparece na vitrine pública
- [ ] Link `/events/:id/inscricao` funcional
- [ ] Relatório de inscrições populado após inscrições

---

### CT-EVT-002 — Criar evento com venda de ingressos

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Criar evento pago
2. Criar lotes em `/manager/wristbands`
3. Definir preço, quantidade, janela de venda
4. Completar checklist go-live (`EventGoLiveChecklist`)
5. Ativar vendas

**Resultado esperado:**
- [ ] Mínimo de ingressos do plano respeitado
- [ ] Lotes visíveis em `/events/:id`
- [ ] `event_accepts_new_sales` true enquanto há estoque

---

### CT-EVT-003 — Edição com vendas em andamento

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/manager/events/edit/:id` |

**Passos:**
1. Com vendas já realizadas, tentar alterar campos críticos (preço, data, lotes)
2. Verificar guard `use-event-edit-sales-guard`

**Resultado esperado:**
- [ ] Campos sensíveis bloqueados ou com aviso
- [ ] Alterações permitidas não quebram ingressos já vendidos

---

### CT-EVT-004 — Banners promocionais do evento

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |
| **Rota** | `/manager/events/banners` |

**Passos:**
1. Criar banner vinculado ao evento
2. Verificar exibição na vitrine / detalhe

**Resultado esperado:**
- [ ] Banner respeita regras de vigência e imagem
- [ ] Banner inativo não aparece

---

### CT-EVT-005 — Geolocalização e mapa

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos:**
1. Cadastrar endereço com CEP
2. Verificar pin no mapa do evento
3. (Admin) rodar backfill em `/admin/settings/event-geo-backfill` se necessário

**Resultado esperado:**
- [ ] Coordenadas salvas; mapa renderiza no detalhe

---

### CT-EVT-006 — Bloqueio por 3+ chargebacks em aberto

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Pré-condições:** gestor com ≥ 3 dívidas `manager_ticket_chargeback_debt` abertas.

**Passos:**
1. Tentar criar novo evento
2. Tentar reativar evento inativo

**Resultado esperado:**
- [ ] INSERT/reativação bloqueados (trigger DB)
- [ ] UI exibe banner com contato EventFest e referência PIX `EF-TCB-{id}`
- [ ] Após quitação admin, bloqueio liberado automaticamente

---

## 6. Landing page, vitrine e filtros

### CT-LP-001 — Visitante não logado

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/informacoes`, `/` |

**Passos:**
1. Abrir `/` sem sessão
2. Abrir `/informacoes`

**Resultado esperado:**
- [ ] Visitante em `/` redireciona para `/informacoes` (modo atual)
- [ ] Landing institucional carrega < 5s
- [ ] Formulário de contato envia com sucesso (`create_public_contact_message`)
- [ ] Mensagem aparece em `/admin/settings/contact-messages`

---

### CT-LP-002 — Cliente logado — vitrine de eventos

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/` |

**Passos:**
1. Login cliente
2. Acessar vitrine `/`
3. Verificar carrossel admin (`/admin/settings/carousel`)

**Resultado esperado:**
- [ ] Apenas eventos públicos/ativos listados
- [ ] Carrossel 3D funcional
- [ ] Cards com imagem, data, local, preço

---

### CT-LP-003 — Filtros da vitrine

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/` |

**Filtros a testar individualmente e combinados:**

| Filtro | Valores |
|--------|---------|
| Busca textual | nome, local, categoria |
| Categoria | cards de categoria |
| Cidade | texto livre |
| Data | seletor de data |
| Preço | gratuito, até R$100, R$100–300, acima R$300 |
| Horário | manhã, tarde, noite |
| Situação | vendas abertas, últimos ingressos |

**Resultado esperado:**
- [ ] Cada filtro reduz lista corretamente
- [ ] Combinação de filtros usa lógica AND
- [ ] “Nenhum evento corresponde…” quando vazio
- [ ] Paginação funciona com filtros ativos

---

### CT-LP-004 — Modo pré-lançamento (preview vs live)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/admin/settings/public-launch` |

**Passos:**
1. Admin define `preview`
2. Visitante comum acessa site
3. Gestor/admin com bypass acessa vitrine

**Resultado esperado:**
- [ ] Público vê landing restrita conforme config
- [ ] Gestor/admin autenticado pode validar antes do live

---

## 7. Compra de ingressos — Mercado Pago

### CT-MP-001 — Checkout MP fluxo feliz

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/events/:id` |

**Passos:**
1. Selecionar lotes e quantidades
2. Clicar comprar → redirect Mercado Pago
3. Pagar com meio de teste
4. Retorno ao site
5. Abrir `/tickets`

**Resultado esperado:**
- [ ] Preferência criada (`create-payment-preference`)
- [ ] Webhook processa pagamento (`mercadopago-webhook`)
- [ ] Ingressos materializados (`materialize_counter_checkout_tickets`)
- [ ] QR dinâmico disponível (`issue-entry-token`)
- [ ] E-mail de confirmação (se configurado)

---

### CT-MP-002 — Pagamento pendente / abandono

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Iniciar checkout e abandonar no MP
2. Voltar a `/tickets`
3. Usar reconciliação se disponível (`reconcile-purchase`)

**Resultado esperado:**
- [ ] Sem ingressos duplicados
- [ ] Status pendente claro; reconciliação após confirmação tardia

---

### CT-MP-003 — Fila de checkout (alto tráfego)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Simular múltiplas sessões comprando mesmo evento popular
2. Observar `join_event_checkout_queue` / `poll_event_checkout_queue`

**Resultado esperado:**
- [ ] Usuário entra na fila com posição visível
- [ ] Após liberação, checkout prossegue normalmente
- [ ] Sem oversell de estoque

---

### CT-MP-004 — Esgotamento de lote

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Comprar até esgotar lote
2. Tentar nova compra

**Resultado esperado:**
- [ ] Lote indisponível na UI
- [ ] `event_accepts_new_sales` false quando aplicável

---

## 8. Splits e transferências — ingressos

### CT-SPLIT-001 — Registro financeiro pós-venda MP

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Concluir venda CT-MP-001
2. Consultar `financial_splits` (SQL ou relatório financeiro gestor)
3. Conferir percentual da faixa de comissão

**Resultado esperado:**
- [ ] `platform_amount` = comissão EventFest
- [ ] `manager_amount` = líquido gestor
- [ ] Soma coerente com valor pago pelo cliente
- [ ] Relatório financeiro gestor bate com split

---

### CT-SPLIT-002 — OAuth Mercado Pago do gestor

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/settings/company-profile` (aba pagamentos) |

**Passos:**
1. Conectar conta MP do gestor
2. Realizar venda
3. Verificar repasse na conta MP do gestor (sandbox/produção)

**Resultado esperado:**
- [ ] OAuth conectado sem erro
- [ ] Split credita gestor conforme contrato MP marketplace

---

### CT-SPLIT-003 — Chargeback ingresso — ticket-only (PIX manual)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Simular chargeback MP em venda de ingresso (plano só ingresso)
2. Gestor vê dívida em `/manager/reports/ticket-chargebacks`
3. Admin registra pagamento PIX manual (`register_ticket_chargeback_debt_manual_payment`)

**Resultado esperado:**
- [ ] Ingresso cancelado; caso em `ticket_chargeback_cases`
- [ ] Referência `EF-TCB-{id}` exibida
- [ ] Dívida baixada após comprovante admin

---

### CT-SPLIT-004 — Chargeback ingresso — plano híbrido (offset D+1)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Chargeback em gestor `ticket_plus_consumption`
2. Verificar `recovery_mode = credit_settlement_offset`

**Resultado esperado:**
- [ ] Abatimento automático em repasse D+1
- [ ] **Não** misturar com fluxo PIX manual

---

## 9. Cliente — meus ingressos e perfil

### CT-CLI-001 — Meus ingressos

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/tickets` |

**Passos:**
1. Após compra, abrir Meus Ingressos
2. Expandir ingresso; visualizar QR
3. Testar impressão (`PrintableTicketSheet`) se disponível

**Resultado esperado:**
- [ ] Lista com evento, lote, status
- [ ] QR dinâmico atualiza sem expor token estático inseguro
- [ ] Histórico de compras coerente

---

### CT-CLI-002 — Dados pessoais e avatar

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/profile` |

**Passos:**
1. Editar nome, telefone, endereço
2. Upload de avatar
3. Salvar e recarregar página

**Resultado esperado:**
- [ ] Dados persistidos
- [ ] Avatar exibido no header
- [ ] Contratos do cliente listados (se houver aceites)

---

### CT-CLI-003 — Inscrição gratuita com turmas

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rotas** | `/events/:eventId/inscricao`, `/events/:eventId/inscricao/sucesso` |

**Passos:**
1. Evento plano vitrine com turmas
2. Cliente inscreve-se informando CPF/dados
3. Gestor confirma presença no relatório de inscrições

**Resultado esperado:**
- [ ] Capacidade por turma respeitada
- [ ] Página de sucesso exibida
- [ ] E-mail de confirmação (conforme [INSCRICAO_GRATUITA_E_EMAIL.md](./INSCRICAO_GRATUITA_E_EMAIL.md))

---

## 10. Carteira EventFest

### CT-WALLET-001 — Recarga via Mercado Pago

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/wallet` |

**Passos:**
1. Iniciar recarga (ex.: R$ 250)
2. Pagar no MP
3. Verificar saldo e extrato (`list_credit_ledger`)

**Resultado esperado:**
- [ ] `credit_topup_settle` credita saldo líquido (após taxas)
- [ ] Extrato com tipo, valor, data, saldo após

---

### CT-WALLET-002 — Histórico de transações

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Após recarga, compra ingresso com carteira, consumo PDV
2. Revisar extrato completo

**Resultado esperado:**
- [ ] Cada movimento com descrição clara
- [ ] Saldos acumulados corretos

---

### CT-WALLET-003 — Rede de aceitação e QR

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Abrir seção rede de aceitação
2. Gerar QR da carteira (`issue-wallet-qr-token`)
3. Operador PDV escaneia (`resolve-wallet-qr`)

**Resultado esperado:**
- [ ] Estabelecimentos do evento/rede listados
- [ ] QR válido por janela de tempo

---

### CT-WALLET-004 — Biometria para gastos altos

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos:**
1. Configurar biometria em `/wallet`
2. Tentar gasto acima do limiar

**Resultado esperado:**
- [ ] Solicita biometria antes de confirmar
- [ ] `mark_client_credit_consumption_intent_biometric` registrado

---

### CT-WALLET-005 — PWA — instalar carteira no celular

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |
| **Referência** | [WALLET_INSTALAR_CELULAR.md](./WALLET_INSTALAR_CELULAR.md) |

**Resultado esperado:**
- [ ] Prompt de instalação exibido em mobile
- [ ] App instalado abre em `/wallet`

---

## 11. Compra de ingresso com carteira + repasse D+1

### CT-CRED-001 — Pagamento ingresso com saldo

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/events/:id` |

**Pré-condições:** evento com consumo crédito habilitado; cliente com saldo.

**Passos:**
1. Escolher pagamento com carteira EventFest
2. Confirmar (biometria se necessário)
3. Verificar ingresso em `/tickets` e débito no extrato

**Resultado esperado:**
- [ ] `credit_spend_consumption` executado
- [ ] Ingresso emitido imediatamente
- [ ] Lançamento em `manager_credit_settlement_ledger` status `pending` (D+1)

---

### CT-CRED-002 — Repasse D+1 — visão gestor

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/credit/settlements` |

**Passos:**
1. Após consumo D0, abrir repasses
2. Aguardar ou simular liberação D+1 (`pending` → `released`)
3. Admin registra TED/PIX (`register_admin_credit_settlement_payment`)

**Resultado esperado:**
- [ ] Gestor vê valores retidos e liberados
- [ ] Após pagamento admin, status `paid`
- [ ] Export CSV funcional

---

### CT-CRED-003 — PDV consumo no evento

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/manager/credit/pdv`, `/wallet/consumo?m=TOKEN` |

**Passos:**
1. Operador abre PDV
2. Cliente exibe QR ou acessa cardápio digital
3. Registrar venda de produto
4. Conferir saldo cliente e relatório consumos gestor

**Resultado esperado:**
- [ ] Débito imediato na carteira
- [ ] Comissão EventFest registrada
- [ ] Aparece em `/manager/reports/credit-spends`

---

### CT-CRED-004 — Consumo cross-parceiro

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Referência** | [CHECKLIST_HOMOLOGACAO_CREDITOS.md](./CHECKLIST_HOMOLOGACAO_CREDITOS.md) |

**Passos:**
1. Cliente com saldo consome em estabelecimento de **outra empresa**
2. Verificar relatório admin aba Cross

**Resultado esperado:**
- [ ] Fluxo entre empresas reconciliado
- [ ] Repasses corretos para cada gestor

---

## 12. Validação de ingressos e chaves de acesso

### CT-VAL-001 — Criar chave de validação

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/validation-keys` |

**Passos:**
1. Gestor cria chave para evento
2. Copiar chave / link para validador

**Resultado esperado:**
- [ ] Chave ativa listada
- [ ] Edge `create-validation-key` sem 401

---

### CT-VAL-002 — Validador público (portaria)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/validator`, `/validador` |

**Passos:**
1. Abrir validador em dispositivo da portaria
2. Informar chave de acesso
3. Escanear QR do ingresso válido
4. Repetir scan (duplicidade)
5. Escanear ingresso cancelado/expirado

**Resultado esperado:**
- [ ] Primeiro scan: entrada autorizada (`validate-ticket`)
- [ ] Segundo scan: aviso já utilizado ou reentrada conforme regra
- [ ] Inválido: mensagem clara
- [ ] Log em `validation_logs` e relatório movimentação

---

### CT-VAL-003 — Revogar chave

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Revogar chave ativa
2. Tentar usar no validador

**Resultado esperado:**
- [ ] Validador rejeita chave revogada imediatamente

---

## 13. Painel gestor — acesso web/PWA

### CT-MGR-001 — Dashboard e KPIs

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/manager/dashboard` |

**Resultado esperado:**
- [ ] Carrega em < 10s
- [ ] KPIs de vendas, ocupação coerentes
- [ ] Banner inatividade ingressos se aplicável

---

### CT-MGR-002 — Menu conforme plano

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:** para cada plano (§1.3), login gestor e inspecionar menu lateral.

**Resultado esperado:**
- [ ] Itens ocultos/bloqueados conforme `plan-features` e billing
- [ ] Parceiro sem pulseiras/chaves
- [ ] Vitrine sem financeiro/vendas

---

### CT-MGR-003 — Configurações empresa

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rotas** | `/manager/settings/*` |

**Itens:**
- [ ] Perfil empresa (CNPJ, logo, plano)
- [ ] Perfil individual
- [ ] Notificações
- [ ] Histórico alterações (admin)
- [ ] Operadores PDV

---

### CT-MGR-004 — Notificações in-app

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos:**
1. Gerar evento notificável (venda, chargeback, etc.)
2. Clicar sino `NotificationBell`

**Resultado esperado:**
- [ ] Badge com contagem
- [ ] Lista legível; link para tela relacionada

---

### CT-MGR-005 — Responsividade mobile (gestor)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos:** repetir CT-MGR-001 e CT-EVT-002 em viewport mobile.

**Resultado esperado:**
- [ ] Menu colapsável funcional
- [ ] Formulários utilizáveis sem overflow crítico

---

## 14. Relatórios do gestor (todos)

Testar cada relatório com dados reais pós-compras. Verificar filtros, exportação e coerência com SQL.

| ID | Relatório | Rota | Plano típico | OK |
|----|-----------|------|--------------|-----|
| CT-REP-01 | Financeiro | `/manager/reports/financial` | ingressos | [ ] |
| CT-REP-02 | Financeiro por evento | `/manager/reports/financial/:eventId/:eventName` | ingressos | [ ] |
| CT-REP-03 | Vendas | `/manager/reports/sales` | ingressos | [ ] |
| CT-REP-04 | Eventos | `/manager/reports/events` | todos | [ ] |
| CT-REP-05 | Público | `/manager/reports/audience` | ingressos/vitrine | [ ] |
| CT-REP-06 | Inscrições | `/manager/reports/registrations` | vitrine | [ ] |
| CT-REP-07 | Movimentação portaria | `/manager/reports/wristband-movements` | ingressos | [ ] |
| CT-REP-08 | Mensalidade divulgação | `/manager/reports/listing-monthly` | vitrine | [ ] |
| CT-REP-09 | Licença consumo | `/manager/reports/consumption-license` | consumo/licença | [ ] |
| CT-REP-10 | Chargebacks ingresso | `/manager/reports/ticket-chargebacks` | ingressos | [ ] |
| CT-REP-11 | Pacotes cortesia | `/manager/reports/complimentary-bundles` | ingressos | [ ] |
| CT-REP-12 | Consumos crédito | `/manager/reports/credit-spends` | híbrido/licença | [ ] |
| CT-REP-13 | Contábil créditos | `/manager/reports/credit-accounting` | híbrido/licença | [ ] |
| CT-REP-14 | Repasses D+1 | `/manager/credit/settlements` | híbrido/licença | [ ] |

**Critérios comuns:**
- [ ] Relatório oculto no hub quando plano não inclui feature
- [ ] Filtros por período/evento funcionam
- [ ] Export CSV (onde existir) abre sem erro
- [ ] Totais batem com transações de teste

---

## 15. Funcionalidades complementares (não listadas originalmente)

Esta seção cobre o que o sistema já implementa e **não estava** no pedido inicial.

### CT-EXT-001 — Pacotes cortesia Staff

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rotas** | `/manager/events/:eventId/cortesias`, `/cortesia/pacote`, `/cortesia/resgatar` |

**Passos:**
1. Gestor cria pacote cortesia com assentos
2. Envia e-mail/WhatsApp
3. Destinatário resgata via link
4. Valida ingresso na portaria

**Resultado esperado:**
- [ ] Assentos marcados como cortesia
- [ ] Relatório pacotes cortesia atualizado

---

### CT-EXT-002 — Banners promocionais plataforma (admin)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |
| **Rota** | `/admin/banners` |

**Resultado esperado:**
- [ ] Banner global na vitrine conforme vigência

---

### CT-EXT-003 — Observabilidade checkout

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |
| **Rota** | `/admin/settings/checkout-observability` |

**Passos:** executar CT-MP-001 e buscar evento no painel.

**Resultado esperado:**
- [ ] Logs `log_checkout_ops_event` visíveis com timeline

---

### CT-EXT-004 — Painel créditos admin (11 abas)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/admin/settings/credit-reports` |

**Abas:** Passivo, Comissão, Cross, Auditoria, Repasses, Estornos, Contábil, Posição, Receita, Conciliação MP, Chargebacks.

**Resultado esperado:**
- [ ] Cada aba carrega sem spinner eterno
- [ ] Chargebacks: alertas pendentes, baixa PIX manual, waive

---

### CT-EXT-005 — Admin: planos das empresas e overrides

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/admin/settings/companies-billing` |

**Resultado esperado:**
- [ ] Lista empresas com plano, status pagamento
- [ ] Override de comissão/mínimos funcional

---

### CT-EXT-006 — Admin: preços e comissões

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/admin/settings/pricing` |

**Resultado esperado:**
- [ ] 4 abas de plano editáveis
- [ ] Faixas comissão ingressos refletem no checkout

---

### CT-EXT-007 — Admin: contratos por plano

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/admin/settings/contracts` |

**Resultado esperado:**
- [ ] Nova versão exige reaceite nos gestores afetados

---

### CT-EXT-008 — Admin: matriz plano × menu

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |
| **Rota** | `/admin/settings/plan-features` |

**Resultado esperado:**
- [ ] Alteração reflete no menu gestor após refresh

---

### CT-EXT-009 — Admin: estoque ingressos rede

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |
| **Rota** | `/manager/reports/admin-ticket-inventory` |

---

### CT-EXT-010 — Admin: backup banco

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |
| **Rota** | `/manager/settings/backup-database` |

---

### CT-EXT-011 — Admin: redes e contato público

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/admin/settings/public-social` |

**Resultado esperado:**
- [ ] Telefone/WhatsApp usados em chargeback e landing

---

### CT-EXT-012 — Feedback landing

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Resultado esperado:**
- [ ] `LandingFeedbackPanel` envia feedback sem erro

---

### CT-EXT-013 — Chargeback recarga carteira (absorção EventFest)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Referência** | [CHECKPOINT_RECARGA_CREDITO_1X_CHARGEBACK.md](./CHECKPOINT_RECARGA_CREDITO_1X_CHARGEBACK.md) |

**Resultado esperado:**
- [ ] Alerta no dashboard admin
- [ ] Registro na aba Chargebacks do painel créditos

---

## 16. Matriz plano × caso de teste mínimo

| Caso | Vitrine | Ingressos | Híbrido | Licença | Parceiro |
|------|:---:|:---:|:---:|:---:|:---:|
| CT-PLAN-001..008 | ● | ● | ● | ● | ● |
| CT-EVT-001 | ● | | | ● | |
| CT-EVT-002 | | ● | ● | | |
| CT-MP-001 | | ● | ● | | |
| CT-CRED-001..004 | | | ● | ● | ● |
| CT-VAL-001..003 | | ● | ● | | |
| CT-REP-01..14 | conforme tabela §14 | | | | |

---

## 17. Regressão rápida pós-deploy

Executar em sequência (~30 min) após cada release crítica:

1. [ ] CT-AUTH-003 — cold boot
2. [ ] CT-LP-002 — vitrine logado
3. [ ] CT-MP-001 — compra MP
4. [ ] CT-VAL-002 — validação portaria
5. [ ] CT-WALLET-001 — recarga
6. [ ] CT-CRED-001 — ingresso com carteira
7. [ ] CT-MGR-002 — menu gestor plano ingressos
8. [ ] CT-REP-01 — relatório financeiro

Checklist detalhado: [CHECKLIST_QA_GO_LIVE_30MIN.md](./CHECKLIST_QA_GO_LIVE_30MIN.md)

---

## 18. Registro de execução

| Data | Executor | Ambiente | Build/commit | P0 falhos | Observações |
|------|----------|----------|--------------|-----------|-------------|
| | | | | | |

---

## 19. Histórico do documento

| Versão | Data | Alteração |
|--------|------|-----------|
| 1.0 | 2026-07-16 | Criação inicial com base no código e checklists existentes |
