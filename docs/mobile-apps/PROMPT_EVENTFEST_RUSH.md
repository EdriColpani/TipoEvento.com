# PROMPT — EventFest Rush (App Cliente)

> **Uso:** copie este documento integralmente ao iniciar o projeto mobile do cliente final.
> **Repositório sugerido:** `eventfest-rush` (1 repo, iOS + Android)
> **Backend:** mesmo Supabase do projeto web EventFest (`tipoevento`)

---

## Contexto

Você vai criar o aplicativo mobile **EventFest Rush** para o **público final** — pessoas que descobrem eventos, compram ingressos, participam de inscrições gratuitas e usam o ingresso no dia do evento.

O nome **Rush** comunica velocidade: encontrar evento, comprar em poucos toques e ter o **QR do ingresso na mão** na hora da entrada.

Este app **não** é para gestores (→ **EventFest Manager**) nem para equipe de portaria (→ **EventFest Validator**).

---

## Stack técnica

- **Expo (React Native) + TypeScript**
- **Supabase JS** — auth, dados públicos, compras, carteira
- **React Query** — cache agressivo para listas e ingressos
- **React Navigation** — tabs + modais
- **Expo Camera** — leitura QR (cortesia, opcional)
- **Expo Notifications** — confirmação de compra, lembrete de evento
- **Expo Secure Store** — sessão e tokens de carteira
- **react-native-qrcode-svg** ou similar — exibir QR do ingresso
- Design: tema escuro, acento ciano/amarelo conforme contexto (home pública vs área logada)

---

## Autenticação e perfil

### Visitante (sem login)
- Navegar vitrine de eventos (quando site não estiver em modo pré-lançamento restrito)
- Ver detalhes públicos do evento
- Ao comprar ou salvar favorito: exigir login

### Login e cadastro
- E-mail + senha
- Cadastro cliente (tipo usuário 3): nome, e-mail, senha, CPF opcional conforme regra
- Recuperação de senha
- Login social (fase 2, se habilitado no Supabase)
- Persistência de sessão

### Perfil do cliente
- Dados pessoais: nome, CPF, RG, endereço, telefone, avatar
- Alerta de perfil incompleto (necessário para algumas ações)
- Histórico de compras (fase 2)
- Preferências de notificação
- Excluir conta / LGPD (fase 2)

### Modo pré-lançamento
- Se plataforma em `preview`: visitante vê conteúdo institucional limitado
- Cliente logado em preview: mesma regra do web
- Admin/gestor não usa este app para operar

---

## Funcionalidades — Fase 1 (MVP)

### 1. Home / Descoberta
- Carrossel de banners promocionais
- Lista de eventos em destaque
- Busca por título, cidade, categoria
- Filtros: data (hoje, semana, mês), preço (grátis, faixas), horário (manhã/tarde/noite)
- Cards de categoria (música, gastronomia, etc.)
- Pull-to-refresh e paginação infinita
- Estado vazio e erro com retry

### 2. Detalhe do evento
- Imagem, título, data, hora, local com mapa (abrir Maps/Waze)
- Descrição, categoria, organizador
- Lista de lotes/ingressos: nome, preço, disponibilidade
- Indicador "últimos ingressos" quando estoque baixo
- Evento gratuito / inscrição: CTA "Inscrever-se"
- Evento pago: seletor de quantidade por lote
- Compartilhar evento (link deep link `eventfest://events/{id}`)
- Favoritar evento (fase 2 — local ou servidor)

### 3. Compra de ingressos
- Carrinho resumido (lote × quantidade)
- Resumo: subtotal, taxas (se houver), total
- Fila de checkout (queue) quando evento com alta demanda — mesma lógica web
- Pagamento:
  - **PIX** e **cartão** via Mercado Pago (webview ou SDK nativo)
  - Redirecionamento e retorno com deep link
- Tela de processamento / aguardando confirmação PIX
- Tela de sucesso com resumo e CTA "Ver meus ingressos"
- Tratamento de erro: pagamento recusado, timeout, estoque esgotado durante checkout
- Idempotência de checkout (não cobrar duas vezes)

### 4. Meus ingressos
- Lista de ingressos ativos e passados
- Card: evento, data, local, tipo de acesso, status (ativo, usado, cancelado)
- **Tela do ingresso (killer feature):**
  - QR code grande (brilho máximo, fullscreen)
  - Código alfanumérico legível
  - Nome do titular (quando permitido)
  - Countdown para o evento
  - Instruções de uso na portaria
- **Modo offline:** cache local do QR após primeira abertura (validar no dia sem internet)
- Ingresso usado: marca visual "já utilizado"
- Reenviar comprovante por e-mail (chamar API existente)

### 5. Inscrição gratuita (eventos vitrine)
- Formulário de inscrição conforme evento
- Confirmação e e-mail
- QR de inscrição na área "Meus ingressos"
- Validação no dia do evento (mesmo fluxo do validador)

### 6. Conta e suporte
- Login / cadastro / logout
- Editar perfil
- Central de ajuda / FAQ
- Contato com organizador ou suporte plataforma
- Termos de uso e privacidade

---

## Funcionalidades — Fase 2

### 7. Carteira EventFest (créditos)
- Saldo de créditos do cliente
- Recarga via PIX/cartão (webview)
- Histórico de movimentações
- QR da carteira para consumo no evento
- Biometria/PIN para pagar com crédito acima do limiar configurado
- Menu de consumo no evento (produtos do estabelecimento)
- Pagamento PDV: gestor escaneia QR do cliente

### 8. Cortesias
- Abrir link de cortesia (`/cortesia/pacote`)
- Resgatar assento/ingresso com código
- Ingresso cortesia aparece em "Meus ingressos"

### 9. Notificações push
- Compra confirmada
- Lembrete 24h e 2h antes do evento
- Evento adiado/cancelado
- Ingressos quase esgotando (eventos favoritos)
- Promoções (opt-in)

### 10. Experiência pós-compra
- Adicionar ao calendário do celular (.ics)
- Como chegar (mapa)
- Política de reembolso do evento
- Avaliação pós-evento (estrelas + comentário)

---

## Funcionalidades — Fase 3

### 11. Social e retenção
- Favoritos e lista de desejos
- Seguir organizador/gestor
- Indicação de amigos (referral)
- Wallet pass (Apple Wallet / Google Wallet) — ingresso nativo

### 12. Pagamentos avançados
- Salvar cartão tokenizado
- Parcelamento (se MP permitir)
- Pagar com créditos + cartão (split)

### 13. Acessibilidade e inclusão
- Modo alto contraste no QR
- Tamanho de fonte ajustável
- VoiceOver / TalkBack nos fluxos críticos

---

## Telas (mapa de navegação)

```
Tab: Explorar (Home)
  → Busca e filtros
  → Detalhe do evento
  → Checkout
  → Sucesso
Tab: Ingressos
  → Lista
  → Detalhe / QR fullscreen
Tab: Carteira (Fase 2)
  → Saldo
  → Recarga
  → QR consumo
  → Histórico
Tab: Perfil
  → Dados pessoais
  → Notificações
  → Ajuda
  → Login/Cadastro (se deslogado)
```

---

## APIs e integrações (reaproveitar do web)

- `use-public-events` — listagem pública
- `use-event-details` — detalhe e lotes
- `use-event-checkout-queue` — fila de compra
- `use-my-tickets` — ingressos do cliente
- RPC: `get_client_credit_balance`, `get_credit_wallet_status`
- Edge Functions: checkout MP, reconcile purchase, e-mail de confirmação
- Deep links: `eventfest://` para retorno de pagamento e abrir evento
- Tabelas: `events`, `wristbands`, `wristband_analytics`, `receivables`, `profiles`

---

## Regras de negócio importantes

1. Só exibir eventos ativos e públicos
2. Respeitar capacidade e estoque em tempo real no checkout
3. QR dinâmico (`entry-qr`) quando configurado — atualizar periodicamente
4. Ingresso só válido na data do evento (mensagem clara se antecipado)
5. Evento `listing_only`: sem checkout pago, apenas inscrição
6. Modo pré-lançamento: restringir vitrine conforme `get_public_launch_mode`

---

## UX e requisitos não funcionais

- **Performance:** home carrega em &lt;2s com cache
- **Offline:** ingressos já baixados funcionam sem rede
- Brilho automático máximo na tela do QR
- Prevenir screenshot do QR (opcional, avaliar impacto UX)
- Skeleton loaders, nunca spinner infinito
- pt-BR
- Analytics: evento de funil (ver → iniciar compra → pagar → ingresso)

---

## Segurança

- Tokens em Secure Store
- Não logar dados de cartão
- QR dinâmico com TTL quando habilitado
- Validar titular do ingresso na portaria (lado Validator)
- Rate limit em tentativas de checkout

---

## Fora de escopo deste app

- Criar/editar eventos → **EventFest Manager**
- Validar ingressos na portaria → **EventFest Validator**
- Painel gestor, relatórios, chaves de validação
- Cadastro de gestor/promotor (pode linkar para web)

---

## Critérios de aceite do MVP

- [ ] Lista eventos reais da plataforma
- [ ] Compra com PIX ou cartão e confirmação
- [ ] Ingresso aparece com QR utilizável
- [ ] QR legível offline após primeiro load
- [ ] Inscrição gratuita em evento vitrine
- [ ] Login/cadastro cliente funcional
- [ ] Deep link de retorno de pagamento
- [ ] Build iOS e Android via Expo EAS

---

## Prompt final para a IA

```
Crie o projeto mobile EventFest Rush com Expo + TypeScript + Supabase,
seguindo todas as especificações do documento PROMPT_EVENTFEST_RUSH.md.
Priorize Fase 1 (MVP): descoberta, compra, meus ingressos com QR offline.
React Query, tema escuro, navegação por tabs. Integrar checkout Mercado Pago
via webview/deep link como no web. Não incluir funções de gestor ou validador.
```
