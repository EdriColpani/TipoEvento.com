# PROMPT — EventFest Manager (App Gestor)

> **Status:** histórico. A decisão atual é **não** criar um segundo app gestor.
> Use em vez disso: [`PROMPT_EVENTFEST_RUSH_GESTOR_INTEGRATION.md`](./PROMPT_EVENTFEST_RUSH_GESTOR_INTEGRATION.md)
> (Modo Cliente + Modo Gestor no app Rush existente).
>
> Este arquivo permanece como referência de escopo funcional do gestor.

> **Uso (legado):** copiar para criar app gestor separado — **não recomendado** no momento.
> **Repositório sugerido (legado):** `eventfest-manager`
> **Backend:** mesmo Supabase do projeto web EventFest (`tipoevento`)

---

## Contexto

Você vai criar o aplicativo mobile **EventFest Manager** para **gestores e promotores de eventos** (tipo de usuário 2 no sistema; Admin Master tipo 1 pode ter acesso ampliado, mas o foco do app é o gestor PJ/PF).

O app **não** é para validar ingressos na portaria (isso é o app **EventFest Validator**) e **não** é para compra de ingressos (isso é o **EventFest Rush**).

O gestor usa o app para **criar e operar eventos**, acompanhar vendas, gerenciar ingressos, equipe de validação (via chaves), créditos/consumo no evento e relatórios resumidos — especialmente no dia a dia e no dia do evento.

---

## Stack técnica

- **Expo (React Native) + TypeScript** (preferencial, alinhado ao web React)
- **Supabase JS** — auth, queries, RPC, realtime onde fizer sentido
- **React Query (TanStack Query)** — cache e sincronização
- **React Navigation** — tabs + stack
- **Expo Notifications** — push de alertas operacionais
- **Secure Store** — tokens de sessão
- Design system: tema escuro com destaque amarelo/dourado (identidade EventFest gestor)

---

## Autenticação e perfil

### Login
- E-mail + senha (Supabase Auth)
- Recuperação de senha (deep link para web ou in-app browser)
- Sessão persistente com refresh automático
- Logout local e remoto

### Perfil e onboarding
- Cadastro de gestor (fluxo existente: PF → opcional PJ)
- Perfil individual (nome, CPF, RG, endereço, avatar)
- Perfil empresa (razão social, CNPJ, endereço, logo) quando PJ
- Aceite de contrato/termos da plataforma
- Indicador de cadastro incompleto
- Bloqueio de funcionalidades até billing/plano ativo (regra `isCompanyBillingReady` do web)

### Permissões por plano
- Respeitar `plan_features` da empresa (mesmas chaves do web: `dashboard`, `events`, `events_create`, `wristbands`, `validation_keys`, `reports_*`, etc.)
- Itens bloqueados: exibir cadeado + CTA para regularizar plano/pagamento
- Admin Master (tipo 1): bypass de plano onde aplicável no web

---

## Funcionalidades — Fase 1 (MVP)

### 1. Dashboard
- Cards: vendas hoje / semana / mês
- Ingressos vendidos vs capacidade (eventos ativos)
- Receita líquida estimada (quando plano permitir)
- Gráfico simples de vendas (7 ou 30 dias)
- Alertas: estoque baixo (&lt;10%), evento sem ingresso configurado, pagamento pendente
- Lista de eventos próximos (próximos 7 dias)
- Atalhos: criar evento, ver vendas, gerar chave de validação

### 2. Eventos
- Lista de eventos do gestor (filtro: ativos, rascunho, passados)
- Busca por título/cidade
- Card: imagem, título, data, local, status, % vendido
- Detalhe resumido: capacidade, lotes, status de publicação
- Ações rápidas: ativar/desativar evento, compartilhar link público
- **Criar evento (versão simplificada mobile):**
  - Título, descrição curta, categoria, data/hora, local/endereço
  - Capacidade, imagem de capa
  - Modo vitrine vs venda de ingressos
  - Salvar rascunho / publicar
- **Editar evento:** mesmos campos essenciais (edição completa avançada pode abrir web view)

### 3. Ingressos (pulseiras / lotes)
- Lista de lotes por evento
- Criar lote: nome, tipo de acesso (inteira/meia/etc.), preço, quantidade
- Ver vendidos / disponíveis / reservados
- Pausar venda de um lote
- Alerta visual de estoque crítico

### 4. Chaves de validação (gestão — não validação)
- Listar chaves por evento
- Criar chave: nome da equipe, evento vinculado, validade (data/hora)
- Exibir chave **uma vez** ao criar (copiar/compartilhar WhatsApp)
- Revogar / desativar chave
- Ver último uso e status
- **Instrução clara:** equipe usa o app **EventFest Validator**, não este app

### 5. Notificações
- Push: estoque baixo, nova venda (opcional), chave expirando, mensagem de contato (admin)
- Inbox in-app com histórico
- Preferências: ligar/desligar por tipo

### 6. Configurações
- Editar perfil PF/PJ
- Dados de pagamento/recebimento (link ou web view para MP OAuth se complexo)
- Sair da conta
- Versão do app, suporte, termos

---

## Funcionalidades — Fase 2

### 7. Relatórios (visão mobile)
- **Vendas:** total, por evento, por período, ticket médio
- **Eventos:** ocupação, status, comparativo
- **Financeiro resumido:** bruto, comissão, líquido (sem export pesado)
- **Público:** demografia básica (idade, cidade) quando disponível
- **Inscrições gratuitas** (eventos vitrine)
- **Movimentação de ingressos:** entradas na portaria em tempo quase real (leitura do validador)
- Export PDF/Excel: abrir web ou compartilhar arquivo gerado no backend

### 8. Cortesias
- Criar pacote de cortesias por evento
- Definir quantidade e link/código de resgate
- Acompanhar resgates
- Relatório de cortesias emitidas/utilizadas

### 9. Banners de evento
- Listar banners promocionais
- Criar/editar banner (imagem, link, evento, ordem, ativo)
- Preview

### 10. Carteira de créditos do evento (se plano habilitar)
- Estabelecimentos (bares, food trucks) vinculados ao evento
- PDV: visão de vendas por estabelecimento (somente leitura no mobile gestor)
- Relatório de consumo de créditos
- Liquidações pendentes

### 11. Mensalidade e cobranças
- Faturas de plano vitrine (listing monthly)
- Licença de consumo
- Status de pagamento e link para quitar

---

## Funcionalidades — Fase 3

### 12. Operações avançadas
- Checklist go-live do evento
- Edição completa de evento (todos os passos do wizard web)
- Gestão de fila de checkout (observabilidade)
- Histórico de alterações de configuração
- Múltiplos usuários da mesma empresa (quando existir no backend)

### 13. Integrações
- Compartilhar evento (WhatsApp, Instagram Stories deep link)
- Widget resumo para tela inicial do celular (futuro)
- Biometria para abrir app (Face ID / impressão digital)

---

## Telas (mapa de navegação)

```
Tab: Início (Dashboard)
Tab: Eventos
  → Lista
  → Detalhe
  → Criar / Editar
  → Ingressos (lotes)
  → Cortesias
  → Banners
Tab: Relatórios
  → Hub de relatórios
  → Vendas / Financeiro / Público / Portaria
Tab: Mais
  → Chaves de validação
  → Notificações
  → Perfil PF/PJ
  → Plano e cobranças
  → Configurações
  → Sair
```

---

## APIs e integrações (reaproveitar do web)

- Supabase Auth (`signInWithPassword`, `getSession`, `onAuthStateChange`)
- Tabelas: `profiles`, `companies`, `events`, `wristbands`, `validation_api_keys`, `wristband_analytics`, `receivables`, `company_billing`, `plan_features`
- RPCs e hooks equivalentes: `use-manager-events`, `use-manager-notifications`, `use-dashboard-data`, `use-sales-chart-data`, `fetchManagerNotifications`
- Edge Functions existentes para pagamentos (abrir web view quando necessário)
- **Não chamar** endpoint de validação de ingresso como gestor no dia a dia — isso é o app Validator

---

## Regras de negócio importantes

1. Gestor PF sem empresa: funcionalidades limitadas até cadastro PJ (se exigido pelo plano)
2. Evento `listing_only`: sem venda de ingressos, apenas inscrição/vitrine
3. Bloqueio por inadimplência de plano: leitura permitida, escrita bloqueada
4. Features por plano: consultar `company_plan_features` antes de exibir menu
5. Admin Master pode ver todos os eventos; gestor só os da sua empresa/escopo

---

## UX e requisitos não funcionais

- Offline: dashboard e listas em cache (stale-while-revalidate)
- Pull-to-refresh em listas
- Skeleton loading (nunca tela branca travada)
- Feedback toast em ações
- Acessibilidade: tamanhos de toque ≥ 44pt, contraste AA
- Idioma: pt-BR
- Performance: lista de eventos paginada (20 por página)

---

## Segurança

- Nunca armazenar chave de validação em plain text persistente no app gestor após compartilhamento
- Tokens Supabase em secure storage
- Certificate pinning (opcional fase 2)
- Logout ao detectar conta desativada
- Sem exposição de dados de outros gestores (RLS do Supabase)

---

## Fora de escopo deste app

- Validar QR na portaria → **EventFest Validator**
- Comprar ingresso como cliente → **EventFest Rush**
- Admin Master global (planos da plataforma, todas empresas, backup DB)
- Edição de carrossel da home pública
- Modo pré-lançamento do site

---

## Critérios de aceite do MVP

- [ ] Gestor loga e vê dashboard com dados reais
- [ ] Lista e cria evento simplificado
- [ ] Cria lote de ingressos e vê estoque
- [ ] Gera chave de validação e compartilha
- [ ] Recebe push de estoque baixo
- [ ] Respeita bloqueio de plano inativo
- [ ] Build iOS e Android via Expo EAS

---

## Prompt final para a IA

```
Crie o projeto mobile EventFest Manager com Expo + TypeScript + Supabase,
seguindo todas as especificações do documento PROMPT_EVENTFEST_MANAGER.md.
Priorize Fase 1 (MVP). Reutilize a API do backend EventFest existente.
Tema escuro com acento amarelo. Navegação por tabs. React Query para dados.
Não inclua validação de ingressos (app separado Validator).
```
