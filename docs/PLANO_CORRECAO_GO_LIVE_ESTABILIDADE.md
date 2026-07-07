# Plano de correção go-live — Estabilidade EventFest

**Atualizado:** 2026-07-06  
**Status:** Fase A concluída · Fase B em execução (2026-07-06)  
**Checklist QA:** [CHECKLIST_QA_GO_LIVE_30MIN.md](./CHECKLIST_QA_GO_LIVE_30MIN.md)

---

## Decisão de produto (2026-07-06)

**Vitrine pública (opção B):** liberar `/` e `/events/:id` para visitante **somente após o lançamento**. Até lá, login obrigatório via `ClientAuthGate`. Implementar na Fase D pós go-live.

---

## Resumo executivo

O risco principal **não é uma tela isolada** — é a combinação de:

1. **Auth central instável** (`PublicLaunchModeContext` + `getSession()` sem isolamento REST).
2. **Centenas de chamadas diretas** ao `@supabase/supabase-js` (sem timeout/REST unificado).
3. **Migrations SQL** possivelmente desalinhadas entre repo e produção.
4. **Decisão de produto:** vitrine exige login (`ClientAuthGate`).

**Meta:** em **5–7 dias úteis** (ou antes, se Fases A–C em paralelo), eliminar spinners/crashes nos fluxos que clientes e gestores usam no dia 1.

**Ordem:** Fase A (auth) → deploy + migrations → Fase B (cliente) → Fase C (gestor) → Fase D (hardening).

---

## Inventário de problemas (prioridade)

### P0 — Bloqueia go-live (corrigir primeiro)

| ID | Problema | Sintoma | Onde |
|----|----------|---------|------|
| P0-1 | `getSession()` sem timeout no contexto global | Site inteiro trava após deploy/reload | `PublicLaunchModeContext.tsx` |
| P0-2 | Auth duplicada / corrida de listeners | Login/logout inconsistente | Login, Context, hooks |
| P0-3 | Migrations críticas não aplicadas | RPC/trigger ausente, PDV quebra | Supabase remoto |
| P0-4 | Contrato evento com versão NULL | Gestor não salva evento | `EventFormSteps` + trigger DB |
| P0-5 | Crashes JS por import faltando | Tela branca / ReferenceError | Vários (ex.: `ManagerEventsList`) |

### P1 — Alto impacto operacional

| ID | Problema | Sintoma |
|----|----------|---------|
| P1-1 | Formulário `/informacoes` RPC direto | “Enviando…” eterno |
| P1-2 | Checkout / inscrição / `EventDetails` RPC client | Compra trava |
| P1-3 | Telas gestor/admin sem `usePageAuth` | Spinner longo |
| P1-4 | PDV intents `pf.full_name` | Erro SQL no PDV |
| P1-5 | Upload avatar só via client JS | Foto perfil trava |

### P2 — Produto / pós go-live imediato

| ID | Problema | Decisão necessária |
|----|----------|-------------------|
| P2-1 | Vitrine exige login | Liberar `/` e `/events/:id` para visitante? |
| P2-2 | Logout → `/informacoes` | Redirecionar para `/login`? |
| P2-3 | Admin dashboards 17+ RPCs diretos | Migrar gradualmente para REST |

---

## O que já foi corrigido (sessão recente — validar em produção)

| Item | Arquivo / migration | Pendente deploy? |
|------|---------------------|------------------|
| Login REST + cache sessão | `auth-rest.ts`, `Login.tsx` | Verificar bundle no ar |
| Upload imagens evento REST | `supabase-storage-rest.ts` | Verificar bundle |
| `contract_version` no save evento | `use-company-billing`, `EventFormSteps` | **Sim — front** |
| Trigger contrato evento (só reaceite) | `20260730160000_fix_event_contract_version_enforcement.sql` | **Sim — `db push`** |
| Status Encerrado / Publicado | `manager-event-status.ts`, `ManagerEventsList` | **Sim — front** |
| E-mail gestor admin billing | `20260730150000_admin_companies_manager_email.sql` | **Sim — `db push`** |
| Imports `useEventEditSalesGuard`, `EventActivationBlockers` | `EventFormSteps`, `ManagerEventsList` | **Sim — front** |

---

## Migrations obrigatórias antes de clientes

Executar na ordem (ver [ALINHAMENTO_MIGRATIONS_SUPABASE.md](./ALINHAMENTO_MIGRATIONS_SUPABASE.md) se `db push` conflitar):

| Prioridade | Migration | Se faltar, quebra |
|------------|-----------|-------------------|
| **P0** | `20260730160000_fix_event_contract_version_enforcement.sql` | Salvar evento (contrato) |
| **P0** | `20260730140000_fix_credit_intent_profile_label.sql` | PDV / intents (`full_name`) |
| **P1** | `20260730150000_admin_companies_manager_email.sql` | Admin planos (e-mail gestor) |
| **P1** | `20260728120000_fix_partner_company_create_perf.sql` | Criar empresa parceira |
| **P1** | `20260725120000_public_launch_mode.sql` | Modo preview/live errado |
| **P1** | `20260630170000_contact_messages.sql` | Formulário contato |

```powershell
cd c:\V3\tipoevento
supabase link --project-ref lzsjxepcsgwsnpsjzpcm
supabase db push --linked --yes
```

---

## Plano em PRs pequenos (execução)

Cada PR: **uma fase ou sub-fase**, build verde, QA do [checklist](./CHECKLIST_QA_GO_LIVE_30MIN.md) da seção correspondente.

### PR-1 — Fase A: Auth núcleo (P0) — **1–2 dias**

**Objetivo:** uma única fonte de sessão; zero `getSession()` bloqueante no boot global.

| # | Tarefa | Arquivos principais |
|---|--------|---------------------|
| A1 | `PublicLaunchModeContext`: boot só `readCachedAuthSession()` + REST `/auth/v1/user` com timeout 5s | `PublicLaunchModeContext.tsx` |
| A2 | Remover `getSession().then()` sem timeout; não deixar promise pendente contaminar aba | idem |
| A3 | Unificar listeners: um `onAuthStateChange` no context; remover duplicatas em Login/hooks | `Login.tsx`, hooks auth |
| A4 | Cadastro gestor: `signInWithPassword` → REST (como login) | `promoter-registration-flow.ts`, `ManagerCompanyRegister.tsx` |
| A5 | `getAuthAccessToken()` como único getter de token em utils/hooks novos | `auth-session-cache.ts` |
| A6 | Logout: garantir limpeza storage + não chamar `getSession` após signOut | `sign-out-session.ts` |

**Critério de aceite PR-1:** checklist §2.5, §3.7, §5.1–5.4 **sem** limpar cookies.

---

### PR-2 — Fase B: Cliente go-live (P1) — **1–2 dias**

| # | Tarefa | Arquivos principais |
|---|--------|---------------------|
| B1 | `/informacoes` + `LandingFeedbackPanel` → `callRpcRest` ou REST com timeout + toast erro | `InformacoesPage`, `LandingFeedbackPanel` |
| B2 | `EventDetails`: saldo/carteira/eligibility via REST/RPC com timeout | `EventDetails.tsx`, hooks |
| B3 | `EventInscriptionPage`: turmas + inscrição com timeout | `EventInscriptionPage.tsx` |
| B4 | `use-my-tickets` / emissão: padronizar REST onde ainda trava | `use-my-tickets.tsx` |
| B5 | `fetchPublicLaunchMode` com timeout (default seguro se falhar) | `public-launch-mode-query.ts` |

**Critério de aceite PR-2:** checklist §1.3–1.4, §2.7–2.8.

---

### PR-3 — Fase C: Gestor operacional (P1) — **2 dias**

| # | Tarefa | Arquivos principais |
|---|--------|---------------------|
| C1 | Aplicar migrations P0/P1 listadas acima | Supabase |
| C2 | `usePageAuth` em telas gestor restantes | `ManagerComplimentaryBundles`, `ManagerCompanyProfile`, `ManagerPaymentSettings`, etc. |
| C3 | `usePageAuth` em telas admin críticas | `AdminDashboard`, `AdminCompaniesBilling`, `AdminCreditReports` |
| C4 | PDV + cortesias: RPC via `callRpcRest` / timeout | `ManagerComplimentaryBundles`, PDV hooks |
| C5 | Upload avatar REST (espelhar evento) | `AvatarUpload` / storage util |
| C6 | Deploy front com fixes já no branch (`contract`, status, imports) | Vercel |

**Critério de aceite PR-3:** checklist §3 completo + PDV smoke (se módulo ativo).

---

### PR-4 — Fase D: Hardening + produto (P2) — **contínuo pós go-live**

| # | Tarefa | Notas |
|---|--------|-------|
| D1 | Migrar RPC/`from` restantes para REST ou `callRpcRest` | `use-credit-reports.tsx` (17 RPCs), etc. |
| D2 | Decidir vitrine pública vs login obrigatório | `ClientAuthGate`, `public-launch-access.ts` |
| D3 | Checklist migrations em todo release | CI ou runbook |
| D4 | Monitoramento: Sentry ou log de timeout auth | opcional |

---

## Cronograma sugerido (correção imediata)

| Dia | Entrega | QA |
|-----|---------|-----|
| **D0 (hoje)** | `db push` migrations P0 + deploy front com fixes já feitos | Checklist §0, §3, §5 |
| **D1** | PR-1 Fase A merge + deploy | Checklist §2, §5 completo |
| **D2** | PR-2 Fase B merge + deploy | Checklist §1 + §2 |
| **D3–D4** | PR-3 Fase C merge + deploy | Checklist §3 + §4 |
| **D5** | Go-live clientes OU PR-4 decisão vitrine | Go/no-go assinado |

Se prazo for **< 3 dias**: fazer **D0 + PR-1 + PR-3 C1/C6** no mínimo; adiar PR-4.

---

## Operação imediata (hoje, antes de codar Fase A)

1. **Banco:** `supabase db push` (migrations `20260730140000`, `20260730150000`, `20260730160000` no mínimo).
2. **Front:** push branch atual → Vercel → confirmar URL de produção no commit certo.
3. **QA:** rodar [CHECKLIST_QA_GO_LIVE_30MIN.md](./CHECKLIST_QA_GO_LIVE_30MIN.md) e anotar falhas.
4. **Go/no-go:** se §5 (stress pós-reload) falhar → **não abrir para clientes** até PR-1.

---

## Matriz de responsabilidade

| Fase | Dono sugerido | Risco se pular |
|------|---------------|----------------|
| A Auth | Backend/front sênior | Tudo trava após deploy |
| B Cliente | Front + 1 fluxo checkout | Cliente não compra / não inscreve |
| C Gestor | Front gestor + DBA migrations | Gestor não opera evento/PDV |
| D Hardening | Backlog pós D+7 | Débito técnico, escala |

---

## Referências no repositório

| Tema | Documento |
|------|-----------|
| Alinhamento migrations | [ALINHAMENTO_MIGRATIONS_SUPABASE.md](./ALINHAMENTO_MIGRATIONS_SUPABASE.md) |
| Créditos homologação | [CHECKLIST_HOMOLOGACAO_CREDITOS.md](./CHECKLIST_HOMOLOGACAO_CREDITOS.md) |
| Planos empresa / contrato | [PLANO_PLANOS_COBRANCA_EMPRESA.md](./PLANO_PLANOS_COBRANCA_EMPRESA.md) |
| Handoff bloqueio planos | [ANALISE_HANDOFF_PLANOS_BLOQUEIO_ONBOARDING.md](./ANALISE_HANDOFF_PLANOS_BLOQUEIO_ONBOARDING.md) |

---

## Próximo passo após sua aprovação

1. Confirmar cronograma (5 dias vs urgência 2–3 dias).
2. Confirmar decisão **P2-1** (vitrine pública ou login obrigatório no lançamento).
3. Iniciar **PR-1 Fase A** (auth) — ou **D0** imediato (migrations + deploy) se ainda não feito.
