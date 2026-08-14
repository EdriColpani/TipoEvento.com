# Plano de teste — Cadastro de gestor e cliente (até seleção de plano)

**Produto:** EventFest  
**Escopo:** somente **cadastro / onboarding** — sem criar evento, sem cortesia, sem venda.  
**Gestor:** do primeiro clique até **selecionar e aceitar o plano comercial**.  
**Cliente:** cadastro completo até confirmação de e-mail e primeiro login.  
**Última atualização:** 2026-08-14  

---

## 0. Objetivo e limites

### Objetivo
Validar ponta a ponta:
1. Cadastro de **gestor** iniciado pela tela **`/informacoes`**
2. Cadastro / continuação de **gestor** pela tela de **`/login`**
3. Telas e etapas do **cadastro de gestor** (tipo de uso, conta, empresa/PF, contrato OTP, plano)
4. Cadastro de **cliente** (`/register`) completo

### Fora de escopo
- Criar/editar evento  
- Pacotes cortesia  
- Checkout / Mercado Pago de venda de ingresso  
- PDV / crédito / validador  
- Chargeback  

### Ambientes
| Item | Valor sugerido |
|------|----------------|
| App | homologação ou `localhost` |
| E-mails | caixa real ou captura Resend (inbox de teste) |
| Navegador | Chrome + 1 mobile |
| Contas | e-mails **novos** por execução (não reutilizar) |

### Legenda
`[ ]` pendente · `[x]` OK · `[F]` falhou · `[N/A]` não aplicável  

---

## 1. Pré-condições de sistema

| # | Pré-condição | Como conferir |
|---|--------------|---------------|
| S1 | Contrato ativo **Cadastro da empresa (Gestor)** | Admin → Contratos · `company_registration` |
| S2 | Contratos de **planos** publicados (tipos do billing) | Admin → Contratos / planos |
| S3 | E-mail de confirmação (Resend) funcionando | Envio de signup |
| S4 | OTP de aceite de contrato por e-mail funcionando | Edges `contract-acceptance-*` |
| S5 | Planos selecionáveis pelo gestor habilitados no catálogo | Tela Plano e cobrança lista opções |

---

## 2. Mapa de rotas (referência)

| Fluxo | Rotas principais |
|-------|------------------|
| Landing gestor | `/informacoes` |
| Entrada cadastro gestor | `/manager/register` |
| Conta gestor | `/manager/register/account` |
| Empresa (PJ) | `/manager/register/company` |
| Login | `/login` |
| Cadastro cliente | `/register` |
| Plano (pós-adesão) | `/manager/settings/company-profile?tab=billing` |
| Destino pós-plano | `/manager/dashboard` (ou checkout do plano, se mensal) |

### Fluxo gestor esperado (ordem correta)
```
/informacoes
  → /manager/register          (Começar cadastro — SEM assinar contrato ainda)
  → modal: Como vai usar?      (Organizador | Parceira)
  → modal: PF ou PJ
  → /manager/register/account  (conta + e-mail)
  → confirmar e-mail
  → /manager/register/company  (ou modal PF)
  → /manager/register          (ASSINAR contrato com OTP + company_id)
  → /manager/settings/...?tab=billing  (escolher e aceitar PLANO + OTP)
  → popup boas-vindas (se implementado) → dashboard / pagamento do plano
```

---

## 3. Smoke (ordem mínima)

| ID | Caso | Prioridade |
|----|------|:----------:|
| SMK-G01 | Informações → PJ → conta → e-mail → empresa → contrato OTP → plano OTP | P0 |
| SMK-G02 | Login com conta pendente → conclui empresa/contrato/plano | P0 |
| SMK-C01 | `/register` cliente → e-mail → login | P0 |

---

# PARTE A — Cadastro de gestor pela tela `/informacoes`

## A1. CT-INF-001 — Entrada pelos CTAs da landing

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/informacoes` |

**Passos:**
1. Abrir `/informacoes` **sem** sessão (aba anônima).
2. Clicar nos CTAs de cadastro (**Cadastre-se** / **Começar** / botão final da página).
3. Clicar **Cadastre-se** no header/menu da página Informações (se existir).

**Resultado esperado:**
- [ ] Navega para `/manager/register` (não abre contrato OTP antes do cadastro)
- [ ] Exibe passo a passo “cadastro primeiro, assinatura depois”
- [ ] Botão **Começar cadastro** visível
- [ ] Botões no padrão de cores do sistema

---

## A2. CT-INF-002 — Seleção de perfil de uso

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Em `/manager/register`, clicar **Começar cadastro**.
2. Ler as duas opções do modal **Como você vai usar a EventFest?**
3. Selecionar **Organizador de eventos** → Continuar.
4. Em nova execução: selecionar **Empresa parceira (consumo)** → Continuar.

**Resultado esperado:**
- [ ] Textos explicam diferença (organizador vs parceira) com exemplos
- [ ] Organizador permite seguir para PF ou PJ
- [ ] Parceira **não** permite PF (erro amigável se tentar individual)
- [ ] Continuar só habilita com opção marcada

---

## A3. CT-INF-003 — Tipo PF vs PJ (organizador)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Após escolher Organizador, modal **Tipo de Cadastro**.
2. Testar **Pessoa Jurídica**.
3. Em outra execução: **Pessoa Física**.

**Resultado esperado:**
- [ ] PJ → vai para `/manager/register/account` (ou company se já logado)
- [ ] PF → exige conta/sessão; se visitante, direciona à criação de conta antes do formulário PF
- [ ] Botões no padrão (amarelo/cyan do tema)

---

## A4. CT-INF-004 — Conta de acesso (etapa 1)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/register/account` |

**Dados válidos (exemplo):**
- Nome: `Maria Gestor QA`
- E-mail: `qa.gestor.{timestamp}@seudominio.com`
- Senha: `Teste@123` (≥ 6)
- Confirmar senha: igual

**Passos positivos:**
1. Preencher todos os campos.
2. Clicar **Enviar confirmação por e-mail**.

**Negativos:**
1. Nome vazio  
2. E-mail inválido  
3. Senha < 6  
4. Senhas diferentes  

**Resultado esperado:**
- [ ] Positivo: tela “Quase lá! Confirme seu e-mail” com e-mail mascarado
- [ ] Negativos: toast/erro sem criar fluxo inconsistente
- [ ] Botão primário e Voltar no padrão de cores (sem fundo branco)

---

## A5. CT-INF-005 — Confirmação de e-mail + “Já confirmei”

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Abrir e-mail EventFest e clicar no link de confirmação.
2. Voltar à tela de confirmação e clicar **Já confirmei — continuar cadastro**.
3. Se pedir login: entrar com e-mail/senha e seguir.

**Negativos:**
1. Clicar **Já confirmei** **antes** de abrir o link → mensagem de que ainda não confirmou (ou login pedindo confirmação).
2. **Reenviar e-mail** → cooldown e novo e-mail.

**Resultado esperado:**
- [ ] Após confirmar + continuar: chega em `/manager/register/company` (PJ) ou fluxo PF
- [ ] Botão “Já confirmei” **não** volta para a mesma tela sem efeito
- [ ] Reenvio funciona com cooldown

---

## A6. CT-INF-006 — Cadastro da empresa (PJ)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/register/company` |

**Campos obrigatórios típicos:** razão social, CNPJ válido único, telefone, e-mail, CEP (busca ViaCEP), rua, número, bairro, cidade, UF.

**Passos:**
1. Preencher dados válidos.
2. Testar CEP válido (preenche endereço) e CEP inválido.
3. **Finalizar cadastro**.

**Negativos:**
1. CNPJ inválido / já cadastrado  
2. Campos obrigatórios vazios  
3. Acessar a rota sem e-mail confirmado → redireciona para conta/login  

**Resultado esperado:**
- [ ] Empresa criada e vinculada ao usuário (owner)
- [ ] Perfil vira gestor (`tipo_usuario_id = 2`)
- [ ] Redireciona para **assinatura do contrato** (`/manager/register`), **não** pula direto ao dashboard
- [ ] Toast indica próximo passo (assinar contrato)

---

## A7. CT-INF-007 — Assinatura do contrato da empresa (OTP)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/register` (com `company_id`) |

**Passos:**
1. Com empresa já criada, a tela mostra o **contrato** (não o “Começar cadastro”).
2. Rolar até o fim + marcar declaração.
3. **Continuar para confirmação** → OTP no e-mail.
4. Informar código → assinar.
5. Seguir para plano / boas-vindas.

**Negativos:**
1. Continuar sem marcar aceite  
2. Continuar sem rolar até o fim  
3. OTP errado / expirado  

**Resultado esperado:**
- [ ] OTP enviado ao e-mail da conta
- [ ] Aceite gravado com evidência (histórico / admin)
- [ ] PDF/hash gerados quando o fluxo seguro estiver ativo
- [ ] Após assinar: destino de **plano** (`?tab=billing`) ou popup de boas-vindas → plano/dashboard conforme implementação
- [ ] **Não** exige assinar contrato antes de existir empresa

---

## A8. CT-INF-008 — Cadastro PF (organizador) até plano

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Fluxo Informações → Organizador → Pessoa Física.
2. Criar/confirmar conta se necessário.
3. Preencher formulário PF (CPF, RG, endereço, etc.).
4. Salvar → assinar contrato OTP → ir à seleção de plano.

**Resultado esperado:**
- [ ] Empresa/vínculo PF criado
- [ ] Contrato assinado com `company_id`
- [ ] Chega na tela de plano

---

## A9. CT-INF-009 — Parceira (consumo) até plano

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Informações → **Empresa parceira** → somente PJ.
2. Conta → e-mail → empresa → contrato → plano.

**Resultado esperado:**
- [ ] PF bloqueado para parceira
- [ ] Plano sugerido coerente (consumo/licença ou híbrido, conforme catálogo)
- [ ] Consegue aceitar plano

---

# PARTE B — Cadastro / continuação de gestor pela tela `/login`

> **Atenção de produto:** o link **“Cadastre-se”** em `/login` abre o cadastro de **cliente** (`/register`), não o de gestor.  
> Cadastro de gestor a partir do login cobre: (1) login com conta já criada no fluxo promotor; (2) link “Já tem conta?” na landing Informações; (3) login e retorno ao cadastro pendente.

## B1. CT-LOG-G01 — “Já tem conta?” na Informações → Login → continua gestor

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/informacoes` → `/login` → cadastro pendente |

**Passos:**
1. Em `/informacoes`, clicar **Já tem conta? Faça login** (state deve apontar ao fluxo gestor).
2. Login com conta que **já confirmou e-mail** mas **ainda não** cadastrou empresa.
3. Observar redirecionamento.

**Resultado esperado:**
- [ ] Vai para `/manager/register/company` (ou `/manager/register` se já tem empresa e falta contrato)
- [ ] Não manda para dashboard de cliente
- [ ] Não abre cadastro cliente

---

## B2. CT-LOG-G02 — Login após criar conta (e-mail confirmado) e concluir cadastro

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Criar conta em `/manager/register/account` e confirmar e-mail pelo link (pode abrir nova aba).
2. Em `/login`, entrar com e-mail/senha.
3. Completar empresa → contrato OTP → plano.

**Resultado esperado:**
- [ ] Sessão válida após login
- [ ] Detecta pendência de promotor/empresa e leva ao passo certo
- [ ] Consegue chegar à seleção de plano

---

## B3. CT-LOG-G03 — Login com e-mail **não** confirmado

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Criar conta gestor e **não** confirmar e-mail.
2. Tentar login.

**Resultado esperado:**
- [ ] Bloqueia ou orienta confirmar e-mail
- [ ] Não entra no painel gestor
- [ ] Não cadastra empresa sem confirmação

---

## B4. CT-LOG-G04 — Login de gestor já completo (empresa + contrato + plano)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Login com gestor que já aceitou plano.
2. Verificar destino.

**Resultado esperado:**
- [ ] Vai para `/manager/dashboard` (ou destino pós-login vigente)
- [ ] Não reabre obrigatoriamente o cadastro
- [ ] Header estável (sem piscar Login ↔ Avatar)

---

## B5. CT-LOG-G05 — Distinção Login → Cadastre-se (cliente) vs cadastro gestor

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |
| **Rota** | `/login` |

**Passos:**
1. Em `/login`, clicar **Cadastre-se**.
2. Confirmar que abriu `/register` (cliente).
3. Documentar: para ser gestor, o caminho oficial é `/informacoes` ou `/manager/register`.

**Resultado esperado:**
- [ ] `/register` = cliente
- [ ] QA registra isso para não confundir com bug

---

## B6. CT-LOG-G06 — Cliente logado tenta virar gestor (upgrade)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Cadastrar/logar como **cliente**.
2. Acessar `/informacoes` → Cadastre-se / ou `/manager/register`.
3. Seguir cadastro de empresa (se o produto permitir upgrade).

**Resultado esperado:**
- [ ] Comportamento documentado: upgrade para gestor **ou** mensagem clara se bloqueado
- [ ] Se permitir: conclui empresa + contrato + plano sem corromper perfil cliente antigo de forma inconsistente

---

# PARTE C — Seleção e aceite de plano (fim do cadastro gestor)

> Meta: o gestor **escolhe e aceita o plano**. Checkout de mensalidade (MP) pode ser verificado como passo opcional após o aceite.

## C1. CT-PLAN-001 — Gate de plano após contrato da empresa

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rota** | `/manager/settings/company-profile?tab=billing` |

**Passos:**
1. Após assinar contrato de adesão, cair na aba **Plano e cobrança**.
2. Listar planos disponíveis.
3. Confirmar que **não** acessa livremente criação de evento sem plano (se o gate estiver ativo).

**Resultado esperado:**
- [ ] Planos visíveis com labels em português
- [ ] Gate impede operação plena sem aceite
- [ ] UI no padrão de cores

---

## C2. CT-PLAN-002 — Aceitar plano (OTP) — ticket_commission (ou plano ingresso)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Escolher plano de **comissão sobre ingressos** (ou equivalente selecionável).
2. Abrir contrato do plano → rolar até o fim → marcar aceite.
3. Continuar → OTP e-mail → assinar.
4. Confirmar sucesso.

**Resultado esperado:**
- [ ] RPC/confirmacao de plano OK
- [ ] `billing_plan_accepted_at` preenchido
- [ ] Popup de boas-vindas (se houver) com instruções e botão dashboard
- [ ] Histórico de aceites do contrato do plano disponível

---

## C3. CT-PLAN-003 — Aceitar plano listing_monthly / consumption_or_license

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Aceitar plano que exige pagamento (vitrine mensal ou consumo/licença).
2. Após OTP: popup com opção **Pagar agora** e/ou **Ir ao dashboard**.
3. Se pagar: abre checkout MP (ou dialog pagar depois).

**Resultado esperado:**
- [ ] Aceite do contrato do plano registrado mesmo antes do pagamento
- [ ] Caminho “pagar depois” não perde o aceite
- [ ] Caminho “pagar agora” abre checkout sem erro de sessão

---

## C4. CT-PLAN-004 — Negativos do aceite de plano

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Tentar confirmar sem marcar declaração.
2. Sem rolar contrato até o fim.
3. OTP inválido.

**Resultado esperado:**
- [ ] Bloqueios com mensagem clara
- [ ] Plano **não** fica aceito

---

## C5. CT-PLAN-005 — Critério de encerramento do cadastro gestor

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Checklist final (cadastro gestor = DONE):**
- [ ] Conta Auth criada e e-mail confirmado
- [ ] Empresa (ou PF) vinculada
- [ ] Contrato de adesão (`company_registration`) assinado via OTP
- [ ] Plano comercial selecionado e contrato do plano aceito via OTP
- [ ] Usuário consegue abrir o painel gestor

**Não exige para este plano de teste:** primeiro evento criado.

---

# PARTE D — Cadastro de cliente (tela completa)

## D1. CT-CLI-001 — Abertura da tela `/register`

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |
| **Rotas** | `/register` · link em `/login` |

**Passos:**
1. Abrir `/register` direto.
2. Abrir via Login → **Cadastre-se**.

**Resultado esperado:**
- [ ] Formulário cliente visível
- [ ] Campos: nome, e-mail, CPF, nascimento, gênero, senha, confirmar senha
- [ ] Layout legível no tema escuro

---

## D2. CT-CLI-002 — Validações da tela de cadastro cliente

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Negativos (um por vez):**
1. Nome vazio / curto  
2. E-mail inválido  
3. CPF inválido / incompleto  
4. Data nascimento vazia ou inválida  
5. Gênero não selecionado (se obrigatório)  
6. Senha curta  
7. Senhas diferentes  

**Resultado esperado:**
- [ ] Cada erro aparece no campo ou toast
- [ ] Submit não prossegue

---

## D3. CT-CLI-003 — Cadastro cliente feliz + confirmação de e-mail

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Dados válidos:**
- Nome completo, e-mail novo, CPF válido, nascimento, gênero, senha ≥ 6

**Passos:**
1. Enviar cadastro.
2. Ver tela de confirmação de e-mail (variant cliente).
3. Confirmar pelo link do e-mail.
4. **Já confirmei** / ir ao login.
5. Login em `/login`.

**Resultado esperado:**
- [ ] Conta criada
- [ ] E-mail de confirmação recebido
- [ ] Após confirmar + login: perfil cliente (`tipo_usuario_id = 3`)
- [ ] Destino pós-login cliente (home / complimentary return se houver)

---

## D4. CT-CLI-004 — E-mail já existente

| Campo | Valor |
|-------|-------|
| **Prioridade** | P0 |

**Passos:**
1. Cadastrar com e-mail já usado (cliente ou gestor).

**Resultado esperado:**
- [ ] Mensagem clara (conta existe / confirme e-mail / faça login)
- [ ] Não sobrescreve conta

---

## D5. CT-CLI-005 — Reenvio de e-mail e “Já confirmei”

| Campo | Valor |
|-------|-------|
| **Prioridade** | P1 |

**Passos:**
1. Na tela pós-cadastro, reenviar e-mail.
2. Clicar Já confirmei antes e depois da confirmação.

**Resultado esperado:**
- [ ] Reenvio com cooldown
- [ ] Já confirmei leva a login ou próximo passo coerente (não loop)

---

## D6. CT-CLI-006 — Cadastro cliente vindo de cortesia (se state `from`)

| Campo | Valor |
|-------|-------|
| **Prioridade** | P2 |

**Passos:**
1. Abrir `/register` com `state.from` de pacote cortesia (se disponível no ambiente).
2. Cadastrar, confirmar, logar.

**Resultado esperado:**
- [ ] Retorna ao fluxo de cortesia após login
- [ ] Não mistura com draft de cadastro gestor

---

# PARTE E — Matriz de regressão (cadastro)

| Área | Casos P0 |
|------|----------|
| Informações → gestor | A1, A2, A3, A4, A5, A6, A7, C1, C2 |
| Login → gestor | B1, B2, B3 |
| Plano | C1, C2, C4, C5 |
| Cliente | D1, D2, D3, D4 |

---

## Ordem sugerida de execução (1 sessão QA)

1. **Cliente novo** — D1 → D2 → D3 → D4  
2. **Gestor via Informações (PJ)** — A1 → A2 (organizador) → A3 PJ → A4 → A5 → A6 → A7 → C2 → C5  
3. **Gestor via Login (conta pendente)** — criar conta até e-mail (A4/A5) → logout → B1/B2 → A6 → A7 → C2  
4. **Negativos rápidos** — A4 negativos, A7 OTP errado, C4, B3, D2  
5. **Opcional** — A8 PF, A9 parceira, C3 plano pago  

---

## Evidências sugeridas

Para cada P0, anexar:
1. Print da entrada (`/informacoes` ou `/login`)  
2. Print da conta / confirmação de e-mail  
3. Print empresa ou PF salvo  
4. Print contrato OTP (sem expor código completo)  
5. Print tela de plano + aceite concluído  
6. Print cliente cadastrado + login OK  

---

## Critérios de aceite (definição de pronto)

### Gestor
- [ ] Dá para completar adesão **só** a partir de `/informacoes` até o **plano aceito**
- [ ] Dá para **continuar** adesão a partir de `/login` quando a conta já existe
- [ ] Contrato da empresa **só** depois do cadastro (empresa/PF)
- [ ] Plano exige leitura + OTP
- [ ] Cadastro gestor **não** se confunde com `/register` cliente

### Cliente
- [ ] `/register` e link do login cobrem o formulário completo
- [ ] Validações e e-mail de confirmação OK
- [ ] Login pós-confirmação OK

---

## Registro de execução

| Data | Tester | Ambiente | Build/commit | Resultado | Bugs |
|------|--------|----------|--------------|-----------|------|
| | | | | | |
| | | | | | |
