# Checklist QA go-live — 30 minutos (EventFest)

**Atualizado:** 2026-07-06  
**Objetivo:** validar em ~30 minutos se o sistema está seguro para clientes reais, **sem limpar cookies/storage** entre os passos (exceto no bloco final de stress).  
**Relacionado:** [PLANO_CORRECAO_GO_LIVE_ESTABILIDADE.md](./PLANO_CORRECAO_GO_LIVE_ESTABILIDADE.md) · [ALINHAMENTO_MIGRATIONS_SUPABASE.md](./ALINHAMENTO_MIGRATIONS_SUPABASE.md)

**Ambiente:** produção (`eventfest.com.br`) ou homologação espelhando produção (migrations + bundle atual).  
**Navegador:** Chrome/Edge, aba anônima **e** aba normal (duas sessões).

**Legenda:** `[ ]` pendente · `[x]` OK · `[!]` falhou (anotar tela + hora + print)

---

## 0. Pré-voo (2 min) — antes de abrir o app

- [ ] `supabase db push` aplicado sem erro (ou migrations críticas conferidas no SQL Editor)
- [ ] Deploy Vercel concluído (commit esperado no ar)
- [ ] Edge Functions críticas deployadas (MP webhook, checkout, auth-send-email se hook ativo)
- [ ] Abrir DevTools → **Rede** (preservar log) + **Console** (sem filtrar erros)

**SQL rápido (Supabase SQL Editor):**

```sql
SELECT to_regprocedure('public.enforce_event_contract_on_events()') IS NOT NULL AS contract_trigger_ok,
       to_regprocedure('public.list_admin_companies_billing()') IS NOT NULL AS admin_billing_rpc_ok,
       to_regprocedure('public.create_public_contact_message(text,text,text,text)') IS NOT NULL AS contact_rpc_ok;
```

| Resultado | Esperado |
|-----------|----------|
| `contract_trigger_ok` | `true` (após migration `20260730160000`) |
| `admin_billing_rpc_ok` | `true` (após migration `20260730150000`) |
| `contact_rpc_ok` | `true` |

---

## 1. Visitante / landing (4 min)

| # | Passo | Tempo | OK |
|---|--------|-------|-----|
| 1.1 | Abrir `/informacoes` em aba anônima | 30s | [ ] |
| 1.2 | Página carrega em **< 5s** (sem spinner eterno) | — | [ ] |
| 1.3 | Enviar formulário de contato (nome, e-mail, mensagem) | 1min | [ ] |
| 1.4 | Toast de sucesso ou erro claro (não “Enviando…” eterno) | — | [ ] |
| 1.5 | Tentar `/` sem login → redireciona para `/informacoes` (comportamento atual) | 30s | [ ] |
| 1.6 | Console sem `ReferenceError` / `Uncaught` | — | [ ] |

---

## 2. Cliente — cadastro e sessão (6 min)

**Conta de teste:** e-mail novo ou `+alias` (ex.: `teste+go1@...`)

| # | Passo | Tempo | OK |
|---|--------|-------|-----|
| 2.1 | `/login` → cadastrar ou entrar | 1min | [ ] |
| 2.2 | Botão **Entrar** não fica em “Entrando…” > 15s | — | [ ] |
| 2.3 | Após login, redireciona para destino correto (`/` ou rota anterior) | 30s | [ ] |
| 2.4 | **Logout** pelo menu → cai em `/informacoes` ou login | 30s | [ ] |
| 2.5 | **Login de novo na mesma aba** (sem limpar storage) | 1min | [ ] |
| 2.6 | `/` carrega vitrine ou conteúdo logado em **< 8s** | — | [ ] |
| 2.7 | Abrir detalhe de um evento ativo (`/events/:id`) | 1min | [ ] |
| 2.8 | Página do evento carrega preço/lotes (se pago) sem spinner eterno | — | [ ] |

---

## 3. Gestor — plano, evento, lista (10 min)

**Conta:** gestor com plano **já confirmado** e contrato aceito.

| # | Passo | Tempo | OK |
|---|--------|-------|-----|
| 3.1 | `/login` gestor → dashboard em **< 10s** | 1min | [ ] |
| 3.2 | `/manager/events` — lista abre sem `ReferenceError` no console | 30s | [ ] |
| 3.3 | Evento passado mostra badge **Encerrado**; futuro **Publicado** | 30s | [ ] |
| 3.4 | Criar ou editar evento → preencher passos até **Salvar** | 3min | [ ] |
| 3.5 | Salvar **sem** erro de contrato (`versão NULL` / reaceite indevido) | — | [ ] |
| 3.6 | Upload de imagem (card/banner) conclui em **< 60s** | 1min | [ ] |
| 3.7 | Logout gestor → login gestor **na mesma aba** | 1min | [ ] |
| 3.8 | Voltar à lista — evento salvo aparece com status correto | 30s | [ ] |

---

## 4. Admin — painel mínimo (4 min)

**Conta:** Admin Master.

| # | Passo | Tempo | OK |
|---|--------|-------|-----|
| 4.1 | `/admin` ou dashboard — métricas carregam em **< 15s** | 1min | [ ] |
| 4.2 | `/admin/companies-billing` — tabela com e-mail do gestor visível | 1min | [ ] |
| 4.3 | Abrir edição de plano de uma empresa — sem spinner eterno | 1min | [ ] |
| 4.4 | Console sem erros de RPC “function not found” | — | [ ] |

---

## 5. Stress pós-deploy (4 min) — crítico

Simula o que acontece após `git push` + reload **sem** limpar cookies.

| # | Passo | Tempo | OK |
|---|--------|-------|-----|
| 5.1 | Com sessão ativa (gestor ou cliente), **Ctrl+Shift+R** na página atual | 30s | [ ] |
| 5.2 | Página volta em **< 10s** (não spinner infinito) | — | [ ] |
| 5.3 | Navegar para outra rota protegida (ex.: `/manager/events` ou `/wallet`) | 1min | [ ] |
| 5.4 | Ação que usa API (salvar, listar, comprar simulado) ainda funciona | 1min | [ ] |
| 5.5 | Se falhou: anotar se **limpar storage** “resolve” (indica auth instável) | — | [ ] |

---

## 6. Go / No-go (resumo)

| Critério | Go | No-go |
|----------|-----|-------|
| Login → logout → login na mesma aba | OK em cliente **e** gestor | Qualquer spinner > 15s |
| Salvar evento (gestor com plano OK) | Salva sem erro de contrato | Erro versão NULL / reaceite |
| Lista gestor | Abre sem crash JS | `ReferenceError` / tela branca |
| Formulário `/informacoes` | Resposta em < 10s | Envio eterno |
| Pós Ctrl+Shift+R com sessão | Recupera em < 10s | Só funciona após limpar cookies |
| Migrations críticas | SQL pré-voo `true` | RPC/trigger ausente |

**Assinatura:**

| Papel | Nome | Data | Resultado |
|-------|------|------|-----------|
| Produto | | | Go / No-go |
| Técnico | | | Go / No-go |

---

## Anexo — erros conhecidos a observar

| Sintoma | Provável causa | Doc |
|---------|----------------|-----|
| Spinner infinito após deploy | `getSession()` travado no client Supabase JS | Plano Fase A |
| PDV erro `pf.full_name` | Migration `20260730140000` não aplicada | Plano Fase C |
| Contrato NULL ao salvar evento | Migration `20260730160000` + bundle antigo | Plano Fase C |
| Visitante não vê eventos | `ClientAuthGate` exige login (decisão produto) | Plano Fase D |
| `ReferenceError` em tela gestor | Import removido acidentalmente no bundle | Rebuild + QA 3.2 |
