# Continuidade — Gestor PRO, empresa e eventos

Documento para retomar o trabalho sem perder contexto.

## Contexto resumido

- **Admin Master** salva evento sem passar pela mesma obrigatoriedade de `company_id` que o **Gestor PRO** no `EventFormSteps`.
- O gestor depende de **`user_companies`** + leitura de **`companies`** com JWT `authenticated` (RLS). No Table Editor como `postgres`, as linhas podem existir mesmo quando o app não vê.

## Já implementado no código

- **`ManagerLayout`**: submenu admin com `DropdownMenuSub` (evita menu preso / cliques bloqueados).
- **Contratos**: `normalizeContractContentForDisplay` (`src/utils/contractContent.ts`); HTML de evento sem `<p>` único engolindo o documento; constante **`MANAGER_EVENT_CREATION_CONTRACT_TYPE = 'event_terms'`** (`src/constants/event-contracts.ts`); query em **`EventFormSteps`** filtra **sempre** `event_terms` (inclusive no fallback).
- **Lista de eventos / pulseiras / chaves**: `fetchManagerPrimaryCompanyId` em **`src/utils/manager-scope.ts`** — prioriza `is_primary`, senão qualquer vínculo.
- **`use-manager-company`**: resolve `company_id` via `manager-scope` + SELECT direto em `companies` (sem embed); fallback com só `id` se RLS ocultar colunas.
- **Salvar evento (gestor)**: `Number(tipo_usuario_id) === 2`; no save chama **`fetchManagerPrimaryCompanyId`** de novo; **`ensureGestorCompanyLinked`** aceita `natureza_juridica_id` **null** ou **1** (PF).
- **Cadastro PF**: `ManagerIndividualRegisterDialog` chama `ensureGestorCompanyLinked` após promover perfil.
- **Migrations relevantes** (aplicar no projeto Supabase do `.env`):
  - `20260321000001_fix_event_contracts_literal_newlines.sql`
  - `20260322000001_user_companies_companies_rls_gestor.sql` (RLS `user_companies` / `companies` + função admin para policies)
  - `20260319000014_insert_initial_contracts.sql` (seed com dollar-quote; inclui `client_terms` / `company_registration` — **não** cria `event_terms` por padrão)

## Pendências / verificar no Supabase

1. Existe contrato **`contract_type = 'event_terms'`** ativo (ou pelo menos uma versão) para o fluxo de criação de evento.
2. Para o UUID do gestor: `SELECT * FROM user_companies WHERE user_id = '<uuid>';` — `company_id` preenchido.
3. Confirmar que as migrations RLS foram aplicadas no **mesmo** projeto que o app usa.
4. Opcional: normalizar `tipo_usuario_id` como **number** em `fetchProfile` para evitar `"2" === 2` em outros pontos.

## Arquivos-chave

| Área | Arquivo |
|------|---------|
| Save evento + contrato | `src/components/EventFormSteps.tsx` |
| Empresa gestor (hook) | `src/hooks/use-manager-company.tsx` |
| ID empresa (queries) | `src/utils/manager-scope.ts` |
| PF / vínculo sintético | `src/utils/ensureGestorCompany.ts` |
| Tipo contrato evento | `src/constants/event-contracts.ts` |
| RLS gestor | `supabase/migrations/20260322000001_user_companies_companies_rls_gestor.sql` |

## Próximo passo sugerido

Se o gestor ainda falhar: no navegador, aba **Rede**, filtrar `user_companies` e `companies` — status 200 com `[]` indica RLS ou usuário sem linha; comparar `user_id` com `auth.uid()` no JWT.

---
*Gerado para checkpoint do desenvolvimento; atualize ao concluir itens.*
