# E-mails EventFest — padronização via Resend

Todos os e-mails transacionais do projeto saem pela **Resend**, com layout EventFest (fundo escuro, botão dourado, textos em português).

| Fluxo | Função | Remetente |
|-------|--------|-----------|
| Confirmação de cadastro, reset de senha, magic link, etc. | `auth-send-email` (Auth Hook) | `EventFest <noreply@EventFest.com.br>` |
| Ingresso inscrição gratuita | `send-free-registration-email` | idem |

Código compartilhado: `supabase/functions/_shared/eventfest-mail.ts`

---

## Configuração no Supabase Dashboard

### Onde fica o Hook (UI do Supabase)

O menu mudou em versões recentes. Tente **nesta ordem**:

1. **Link direto do projeto:**
   ```
   https://supabase.com/dashboard/project/lzsjxepcsgwsnpsjzpcm/auth/hooks
   ```
2. Menu lateral **Authentication** → item **Hooks** (não fica dentro de Providers).
3. Se não aparecer: **Authentication** → **Configuration** / **Settings** → seção **Auth Hooks**.

> **Não teste a URL da função no navegador.** Abrir  
> `.../functions/v1/auth-send-email` no Chrome faz **GET** e a função responde `method not allowed` — isso é **esperado**. Só o Supabase Auth chama com **POST** assinado.

### 1. Secrets (Edge Functions)

```bash
supabase secrets set RESEND_API_KEY="re_..."
# Opcional — padrão: EventFest <noreply@EventFest.com.br>
supabase secrets set EVENTFEST_FROM_EMAIL="EventFest <noreply@EventFest.com.br>"
```

O secret `SEND_EMAIL_HOOK_SECRET` é gerado ao criar o hook (passo 3).

### 2. Deploy das funções

```bash
supabase functions deploy auth-send-email --no-verify-jwt
supabase functions deploy send-free-registration-email --no-verify-jwt
```

### 3. Auth Hook — Send Email

**Opção A — Dashboard (se encontrar Hooks):**

1. Abra o link direto acima ou **Authentication → Hooks**
2. **Send Email** → **Create hook** / **Enable**
3. Tipo: **HTTPS** (HTTP Endpoint)
4. URL:
   ```
   https://lzsjxepcsgwsnpsjzpcm.supabase.co/functions/v1/auth-send-email
   ```
5. **Generate Secret** → copie `v1,whsec_...`
6. Configure o secret e redeploy:

```bash
supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_..."
npx supabase functions deploy auth-send-email --no-verify-jwt
```

**Opção B — Se não existir menu Hooks no seu Dashboard:**

Use **Resend via SMTP** (mesmo remetente EventFest, sem hook):

1. **Authentication → Emails → SMTP Settings** → Enable Custom SMTP
2. Host `smtp.resend.com` · Port `465` · User `resend` · Password = sua `RESEND_API_KEY`
3. Sender: `EventFest <noreply@EventFest.com.br>`
4. **Authentication → Emails → Templates** → cole o HTML de `supabase/email-templates/confirm-signup.html` e `reset-password.html` (mantendo `{{ .ConfirmationURL }}`)

Com SMTP Resend, o Supabase envia os e-mails de auth; a Edge Function `auth-send-email` **não é usada** nesse modo.

> Com o **hook** ativo, o Supabase **não envia** e-mail pelo SMTP padrão. Toda auth email passa pela Resend via `auth-send-email`.

### 4. Confirmação de e-mail obrigatória (Dashboard)

**Authentication → Providers → Email → Confirm email**: deve estar **ligado**.

**Authentication → URL Configuration** (crítico — se errado, o link cai em `127.0.0.1:3000`):

| Campo | Valor |
|-------|--------|
| **Site URL** | `https://www.eventfest.com.br` |
| **Redirect URLs** | `https://www.eventfest.com.br/login` |
| | `https://www.eventfest.com.br/reset-password` |
| | `https://www.eventfest.com.br/manager/register/company` |
| | `https://eventfest.com.br/login` (sem www, se usar) |
| | `http://localhost:5173/login` (dev) |

No **build/deploy** do front, defina:

```bash
VITE_SITE_URL=https://www.eventfest.com.br
```

Na Edge Function `auth-send-email`, opcional:

```bash
supabase secrets set SITE_URL="https://www.eventfest.com.br"
```

Isso corrige links antigos que ainda usam `redirect_to` localhost.

### 5. Redirect URLs

**Authentication → URL Configuration → Redirect URLs:**

- `http://localhost:5173/login`
- `http://localhost:5173/reset-password`
- URLs de produção equivalentes

---

## Tipos de e-mail cobertos pelo hook

| `email_action_type` | Assunto |
|---------------------|---------|
| `signup` / `email` | EventFest — Confirme seu cadastro |
| `recovery` | EventFest — Redefinir senha |
| `magiclink` | EventFest — Link de acesso |
| `invite` | EventFest — Você foi convidado |
| `email_change` | EventFest — Confirmar alteração de e-mail |
| `reauthentication` | EventFest — Código de verificação (OTP) |
| Notificações (`password_changed_notification`, etc.) | Avisos simples em PT-BR |

---

## Teste rápido

1. Cadastro em `/register` ou fluxo gestor **Começar Agora**
2. E-mail deve chegar:
   - Remetente **EventFest** (não Supabase Auth)
   - Layout escuro + botão dourado
   - Assunto em português
3. Reset em `/forgot-password` → mesmo padrão visual
4. Inscrição gratuita → e-mail de ingresso no mesmo layout

---

## Troubleshooting

| Problema | Causa provável |
|----------|----------------|
| Ainda chega e-mail Supabase genérico | Hook não ativado ou URL errada |
| 401 no hook | `SEND_EMAIL_HOOK_SECRET` incorreto ou função com JWT ligado |
| 500 no hook | `RESEND_API_KEY` ausente ou domínio não verificado na Resend |
| Resend 403 | Destinatário não autorizado (conta teste) — ver `docs/FIX_401_EDGE_EMAIL.md` |

Logs: Dashboard → Edge Functions → `auth-send-email` → Logs.

---

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `supabase/functions/_shared/eventfest-mail.ts` | Layout + Resend + templates auth/ingresso |
| `supabase/functions/auth-send-email/index.ts` | Auth Hook Send Email |
| `supabase/functions/send-free-registration-email/index.ts` | Ingresso inscrição gratuita |
| `supabase/email-templates/*.html` | Referência visual (legado — hook usa código TS) |
