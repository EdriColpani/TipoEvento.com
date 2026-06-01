# Alinhamento migrations Supabase (local ↔ remoto)

**Situação:** o remoto registra só até `20260316000003`. O restante existe no repo local mas `db push` falha com objetos já criados (schema aplicado manualmente ou fora do histórico).

**Projeto:** `lzsjxepcsgwsnpsjzpcm`

---

## Passo 1 — Diagnóstico

No **SQL Editor** do Supabase, execute:

`supabase/scripts/migration_alignment_diagnostic.sql`

Anote quais objetos/RPCs retornam `true` / existem.

---

## Passo 2 — Marcar como aplicadas (repair)

No PowerShell, na pasta do projeto:

```powershell
cd c:\V3\tipoevento\supabase\scripts
```

### Se o banco já tem quase tudo até créditos fase 12 (cenário típico)

Marque o intervalo **sem** incluir o que ainda falta (ex.: contact_messages, licença):

```powershell
.\align-migrations-repair.ps1 -FromVersion 20260316000004 -ToVersion 20260630160000
```

### Se `db push` parou em uma migration específica ("already exists")

```powershell
.\align-migrations-repair.ps1 -SingleVersion 20260316000004
```

Repita repair + push até não haver mais conflito de "already exists".

---

## Passo 3 — Aplicar o que falta

```powershell
cd c:\V3\tipoevento
supabase db push --linked --yes
```

Se `db push` ainda falhar em SQL não idempotente, aplique manualmente e marque repair:

| Migration | Script manual (se necessário) |
|-----------|-------------------------------|
| `20260630170000` | `supabase/scripts/apply_contact_messages_manual.sql` |
| `20260704120000` | conteúdo de `20260704120000_consumption_license_billing.sql` |
| `20260705120000` | conteúdo de `20260705120000_consumption_license_phase_d.sql` |

Depois de rodar o SQL manual:

```powershell
.\supabase\scripts\align-migrations-repair.ps1 -SingleVersion 20260630170000
```

---

## Passo 4 — Conferir

```powershell
supabase migration list --linked
```

Todas as linhas locais devem ter coluna **Remote** preenchida.

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'list_admin_contact_messages';
```

---

## Regra prática

| Sintoma no `db push` | Ação |
|----------------------|------|
| `already exists` / `duplicate` | `migration repair --status applied` naquela versão |
| `function does not exist` (404 no app) | **Não** repair — aplicar SQL da migration |
| Migration nova, banco limpo | só `db push` |

---

## Histórico remoto atual (referência)

Últimas no remoto antes do alinhamento:

- `20260314000000` … `20260316000003`

Pendentes no local (amostra): `20260316000004` … `20260705120000`

---

*Atualizado em maio/2026.*
