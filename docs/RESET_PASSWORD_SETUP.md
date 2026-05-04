# Redefinição de senha (Supabase Auth)

## Por que o link “não fazia nada”

1. **`redirectTo` antigo era `/login`** — O e-mail redireciona para a URL configurada com tokens no fragmento (`#`). Na tela de login não havia fluxo para **definir nova senha** (`updateUser`).
2. **URL de redirecionamento não autorizada** — No Dashboard do Supabase, só funcionam links cujo destino está em **Redirect URLs**. Se faltar a rota `/reset-password`, o redirect pode falhar ou cair em página em branco.

## O que fazer no Supabase Dashboard

1. **Authentication → URL Configuration**
   - **Site URL**: URL do app em produção (ex.: `https://seu-dominio.com`).
   - **Redirect URLs**: inclua **todas** as origens onde o app roda, por exemplo:
     - `http://localhost:5173/reset-password`
     - `https://seu-dominio.com/reset-password`

2. **Authentication → Email Templates → Reset password**
   - O e-mail “feio” é o template padrão. Edite o HTML e o assunto (ex.: “EventFest — Redefinir senha”).
   - O link do template deve continuar sendo `{{ .ConfirmationURL }}` (o Supabase já monta a URL correta com `redirectTo` do app).

## Fluxo no app (já implementado)

- **Esqueci senha** → `resetPasswordForEmail` com `redirectTo = .../reset-password`
- **Abrir link no e-mail** → Supabase valida e redireciona para `/reset-password#access_token=...&type=recovery`
- **Página Reset password** → sessão de recovery → formulário → `updateUser({ password })` → logout → login

## Edge Function?

Não é obrigatória para o link funcionar. Use Edge + provedor de e-mail (Resend etc.) só se quiser **100% de controle** do HTML e do remetente; o Auth do Supabase já envia o recovery — o que faltava era **rota + Redirect URLs + template opcional**.
