# Plano de implementação — Gestão de operadores PDV (remover / desvincular)

| Campo | Valor |
|-------|--------|
| **Produto** | EventFest — painel do gestor |
| **Módulo** | Equipe / Operadores PDV |
| **Versão do documento** | 1.0 |
| **Data** | 2026-08-29 |
| **Status** | Implementado (Fases 1–4) — executar CT-01 a CT-10 |
| **Referências** | `docs/EMPRESA_PARCEIRA.md`, `/manager/settings/pdv-operators`, RPCs `invite_company_member` / `list_company_members` |

---

## 1. Objetivo

Permitir que o **proprietário da empresa (owner)** gerencie a equipe de **operadores PDV**, incluindo:

1. Manter o fluxo atual de **convidar** um ou mais operadores.
2. **Desvincular** um operador ativo da empresa (revogar acesso ao painel PDV).
3. **Cancelar** convite pendente que ainda não foi aceito.
4. Garantir que a **conta Auth do usuário não seja apagada**, preservando o uso como **cliente** (carteira, ingressos, etc.).

---

## 2. Contexto atual (baseline)

| Capacidade | Situação hoje |
|------------|----------------|
| Tela **Operadores PDV** | Existe (`ManagerPdvOperators.tsx`) |
| Convidar por e-mail | Implementado (`invite_company_member`, papel fixo `pdv_operator`) |
| Listar membros e convites | Implementado (`list_company_members`) |
| Múltiplos operadores | Já permitido (sem limite de 1) |
| Remover / desvincular operador | **Não implementado** |
| Cancelar convite pendente | **Não implementado** |
| Botão “Adicionar Usuário” (aba Gestor) | Placeholder — **fora deste escopo** (permanece como está) |

---

## 3. Regras de negócio

### 3.1 Papéis

| Papel | Descrição |
|-------|-----------|
| `owner` | Proprietário; único autorizado a convidar / remover operadores |
| `pdv_operator` | Colaborador de balcão; acesso restrito (PDV / produtos / estabelecimentos conforme guards existentes) |

### 3.2 Desvínculo (remover operador)

1. Ação disponível apenas para **owner** da empresa (ou Admin Master, se desejável na mesma RPC).
2. Remove o vínculo em `user_companies` para aquele `user_id` + `company_id` com `role = 'pdv_operator'`.
3. **Não** exclui registro em `auth.users` nem `profiles`.
4. **Não** remove saldo/carteira/cliente — o usuário pode continuar como cliente EventFest.
5. **Proibido** remover o próprio `owner` / vínculo `is_primary` por este fluxo.
6. Após o desvínculo, login como operador naquela empresa deve falhar no escopo PDV (menu/guards sem `user_companies` de operador).

### 3.3 Cancelar convite pendente

1. Remove ou marca como cancelado o registro em `company_member_invites` com `accepted_at IS NULL`.
2. E-mail deixa de ser aceito automaticamente no próximo login/cadastro daquele convite.
3. Owner pode reenviar convite depois (fluxo atual de `invite_company_member` / upsert).

### 3.4 Múltiplos operadores

- Continua permitido convidar **N** operadores.
- Cada um aparece na lista “Equipe vinculada” com ação individual de desvínculo.

---

## 4. Escopo da implementação

### 4.1 Incluído

| Camada | Entrega |
|--------|---------|
| **Banco / RPC** | `remove_company_member(p_company_id, p_user_id)` — desvincula `pdv_operator` |
| **Banco / RPC** | `cancel_company_member_invite(p_company_id, p_invite_id)` — cancela convite pendente |
| **Auditoria** | Log mínimo (NOTICE ou tabela de auditoria existente, se houver padrão no projeto) |
| **Frontend util** | Funções em `company-members.ts` |
| **UI** | Botões “Remover” / “Cancelar convite” em `ManagerPdvOperators.tsx` + confirmação |
| **UX** | Toasts de sucesso/erro; atualização da lista após ação |
| **Documentação** | Atualizar trecho operacional em `docs/EMPRESA_PARCEIRA.md` (seção equipe) |
| **Regra Cursor (opcional)** | Nota em regra de parceiro/PDV, se já existir arquivo de regra |

### 4.2 Fora de escopo (explícito)

- Implementar o botão **Adicionar Usuário** da aba Gestor.
- Seletor genérico de papéis além de `pdv_operator`.
- Soft-delete com reativação histórica (v1 = remoção do vínculo; reativar = novo convite).
- Envio de e-mail notificando “você foi removido” (pode ser fase 2).
- Alteração de `tipo_usuario_id` do perfil (não necessário para voltar a ser só cliente).

---

## 5. Plano de implementação (fases)

### Fase 1 — Backend (segurança e contrato)

1. Criar migration com:
   - `remove_company_member(UUID, UUID)`  
     - Valida owner / Admin Master.  
     - Confirma que o membro alvo é `pdv_operator` da empresa.  
     - `DELETE FROM user_companies WHERE ...`.  
     - Retorna JSON `{ ok, removed_user_id }`.
   - `cancel_company_member_invite(UUID, UUID)`  
     - Valida owner / Admin Master.  
     - `DELETE` (ou update) do convite pendente.  
     - Retorna JSON `{ ok, invite_id }`.
2. `GRANT EXECUTE` para `authenticated`.
3. Testar RPCs via SQL (casos feliz / negado).

**Critério de saída da fase:** RPCs aplicadas no ambiente remoto; owner consegue remover/cancelar; operador e anônimo não.

### Fase 2 — Cliente (API)

1. Em `src/utils/company-members.ts`:
   - `removeCompanyMember(companyId, userId)`
   - `cancelCompanyMemberInvite(companyId, inviteId)`
2. Tipagem alinhada ao retorno JSONB.

**Critério de saída:** funções chamáveis sem erro de contrato.

### Fase 3 — Interface

1. Em `ManagerPdvOperators.tsx`:
   - Coluna **Ações** na tabela de membros (exceto owner).
   - Botão **Remover acesso** com `AlertDialog` / confirmação clara (“A conta continua existindo; apenas o acesso PDV desta empresa será removido.”).
   - Em convites pendentes: **Cancelar convite**.
2. Botões no padrão EventFest (amarelo / outline escuro).
3. Recarregar lista após sucesso.

**Critério de saída:** owner conclui remoção e cancelamento só pela UI.

### Fase 4 — Documentação e fechamento

1. Atualizar `docs/EMPRESA_PARCEIRA.md` (convidar + remover + cliente preservado).
2. Executar o **plano de testes** (seção 7).
3. Registrar evidências (passou / falhou) e liberar para produção.

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Owner se remove por engano | RPC bloqueia remoção de `owner` / `is_primary` |
| Remover usuário apaga conta Auth | Implementação só mexe em `user_companies` / invites |
| Operador ainda vê menu em cache | Invalidar contexto / forçar refetch; guards já leem `user_companies` |
| Convite cancelado reaparece | Cancelamento definitivo + invite novo se necessário |

---

## 7. Plano de testes

> Documento de testes no formato: **funcionalidade → o que testar → rotina → resultado esperado**.

### 7.1 Premissas do ambiente de teste

| Item | Requisito |
|------|-----------|
| Empresa | Parceira ou plano com crédito/consumo ativo (`showCreditOptions`) |
| Usuário A | Owner da empresa (gestor principal) |
| Usuário B | Conta existente, vinculada como `pdv_operator` |
| Usuário C | E-mail sem conta (ou conta ainda não vinculada) — convite pendente |
| Usuário D | Cliente EventFest (carteira/ingressos), **sem** vínculo PDV inicial |
| Browser | Sessões distintas (ou janela anônima) para A, B e cliente |

---

### CT-01 — Visualização da tela de gestão

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-01 |
| **Funcionalidade** | Acesso do owner à tela de gestão de operadores PDV |
| **O que precisa testar** | Se o proprietário consegue abrir a tela, ver membros e convites |
| **Descrição da rotina de teste** | 1. Autenticar como Usuário A (owner). 2. Ir em **Configurações → Operadores PDV**. 3. Observar lista “Equipe vinculada” e “Convites pendentes”. |
| **Resultado esperado** | Tela carrega sem erro; membros e convites (se houver) são exibidos; ações de gestão ficam disponíveis apenas para o owner. |

---

### CT-02 — Restrição de acesso (não-owner)

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-02 |
| **Funcionalidade** | Bloqueio de gestão de equipe para operador PDV |
| **O que precisa testar** | Operador não pode gerenciar (convidar/remover) a equipe |
| **Descrição da rotina de teste** | 1. Autenticar como Usuário B (`pdv_operator`). 2. Tentar acessar `/manager/settings/pdv-operators`. |
| **Resultado esperado** | Acesso negado ou mensagem informando que apenas o proprietário gerencia operadores; sem botões de convidar/remover. |

---

### CT-03 — Convidar múltiplos operadores

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-03 |
| **Funcionalidade** | Cadastro de mais de um colaborador com papel `pdv_operator` |
| **O que precisa testar** | Possibilidade de ter N operadores na mesma empresa |
| **Descrição da rotina de teste** | 1. Como owner, convidar operador 1 (e-mail com conta). 2. Convidar operador 2 (outro e-mail). 3. Recarregar a lista. |
| **Resultado esperado** | Ambos aparecem como Operador PDV; nenhum erro de “já existe um operador”; sistema aceita múltiplos vínculos. |

---

### CT-04 — Convite pendente (usuário sem conta)

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-04 |
| **Funcionalidade** | Registro de convite quando o e-mail ainda não possui conta |
| **O que precisa testar** | Persistência do convite e instrução de finalização de cadastro |
| **Descrição da rotina de teste** | 1. Como owner, convidar Usuário C (e-mail novo). 2. Verificar seção de convites pendentes. 3. Criar conta / login com o mesmo e-mail. |
| **Resultado esperado** | Convite listado como pendente; após cadastro/login com o e-mail, vínculo `pdv_operator` é aplicado e o convite deixa de ficar pendente. |

---

### CT-05 — Desvincular operador ativo

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-05 |
| **Funcionalidade** | Remoção do acesso PDV de um colaborador já vinculado |
| **O que precisa testar** | Desvínculo remove acesso à empresa sem apagar a conta |
| **Descrição da rotina de teste** | 1. Como owner, na lista, acionar **Remover acesso** no Usuário B. 2. Confirmar no diálogo. 3. Recarregar lista. 4. Autenticar como Usuário B e tentar abrir PDV/menu de operador. |
| **Resultado esperado** | B some da equipe; toast de sucesso; B não acessa mais PDV da empresa; conta Auth de B permanece válida. |

---

### CT-06 — Preservação do uso como cliente

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-06 |
| **Funcionalidade** | Continuidade do usuário como cliente EventFest após desvínculo PDV |
| **O que precisa testar** | Que remover operador ≠ excluir cliente |
| **Descrição da rotina de teste** | 1. Garantir que Usuário B (ou D após vínculo+remoção) possui uso cliente (ex.: carteira / área do cliente). 2. Desvincular papel PDV (CT-05). 3. Acessar fluxos de cliente (login cliente, carteira ou compra). |
| **Resultado esperado** | Cliente continua autenticável e operacional nos fluxos de cliente; nenhum bloqueio causado pela remoção do vínculo `user_companies` de operador. |

---

### CT-07 — Cancelar convite pendente

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-07 |
| **Funcionalidade** | Cancelamento de convite ainda não aceito |
| **O que precisa testar** | Convite deixa de vincular automaticamente |
| **Descrição da rotina de teste** | 1. Criar convite pendente (e-mail sem vínculo). 2. Como owner, **Cancelar convite**. 3. Criar conta/login com esse e-mail sem novo convite. |
| **Resultado esperado** | Convite some da lista; login/cadastro **não** gera vínculo `pdv_operator` automático para aquela empresa. |

---

### CT-08 — Proteção do owner

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-08 |
| **Funcionalidade** | Impedir remoção do proprietário pelo fluxo de operadores |
| **O que precisa testar** | Owner não é removível como se fosse operador |
| **Descrição da rotina de teste** | 1. Na lista, localizar o owner. 2. Verificar ausência de botão Remover **ou** tentar RPC `remove_company_member` no owner. |
| **Resultado esperado** | UI sem ação de remoção no owner; RPC rejeita com erro claro de permissão/regra. |

---

### CT-09 — Segurança da RPC (não autorizado)

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-09 |
| **Funcionalidade** | Controle de autorização nas RPCs de remoção/cancelamento |
| **O que precisa testar** | Operador ou usuário de outra empresa não remove membros |
| **Descrição da rotina de teste** | 1. Autenticado como `pdv_operator` ou usuário sem ownership, chamar `remove_company_member` / `cancel_company_member_invite` (via cliente ou SQL autenticado). |
| **Resultado esperado** | Operação negada (`Sem permissão` ou equivalente); dados da equipe inalterados. |

---

### CT-10 — Reconvite após remoção

| Campo | Conteúdo |
|-------|----------|
| **ID** | CT-10 |
| **Funcionalidade** | Reativação operacional via novo convite (sem soft-delete) |
| **O que precisa testar** | Ciclo remover → convidar de novo |
| **Descrição da rotina de teste** | 1. Remover operador B (CT-05). 2. Convidar novamente o mesmo e-mail. 3. Validar acesso PDV de B. |
| **Resultado esperado** | Novo vínculo criado; B volta a operar o PDV; lista mostra B novamente como Operador PDV. |

---

## 8. Matriz de rastreabilidade (resumo)

| Regra de negócio | Caso(s) de teste |
|------------------|------------------|
| Tela de gestão pelo owner | CT-01, CT-02 |
| Múltiplos operadores | CT-03 |
| Convite + finalização de cadastro | CT-04 |
| Desvínculo sem apagar conta | CT-05, CT-06 |
| Cancelar convite | CT-07 |
| Proteger owner | CT-08 |
| Autorização | CT-09 |
| Reconvidar | CT-10 |

---

## 9. Critérios de aceite

A entrega é considerada **aceita** quando:

1. Owner convida e remove operadores somente pela tela **Operadores PDV**.
2. É possível ter **dois ou mais** operadores simultâneos.
3. Remover operador **não** exclui a conta; o usuário permanece apto como cliente.
4. Convite pendente pode ser **cancelado**.
5. Todos os casos **CT-01 a CT-10** executados com resultado **Passou** (ou desvio documentado e aprovado).
6. Documento `EMPRESA_PARCEIRA.md` atualizado com o fluxo de remoção.

---

## 10. Estimativa sugerida (ordem de grandeza)

| Fase | Esforço relativo |
|------|------------------|
| Fase 1 — Backend | Pequeno |
| Fase 2 — Cliente API | Muito pequeno |
| Fase 3 — UI + confirmação | Pequeno |
| Fase 4 — Docs + testes | Pequeno a médio |

---

## 11. Aprovação

| Papel | Nome | Data | Assinatura / OK |
|-------|------|------|-----------------|
| Product / negócio | | | |
| Engenharia | | | |
| QA | | | |

---

*Fim do documento — v1.0*
