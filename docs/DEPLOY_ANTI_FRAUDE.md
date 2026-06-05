# Deploy operacional — Anti-fraude

**Última atualização:** 2026-06-02

## 1. Migrations (ordem completa anti-fraude)

Aplicar no Supabase (`supabase db push` ou SQL Editor):

1. `20260711120000` … `20260711140000` — mínimo ingressos  
2. `20260712120000` — inatividade v1  
3. `20260713120000` … `20260713150000` — fase 2 + fixes  
4. `20260714120000` — relatório estoque admin  
5. `20260715120000` … `20260715160000` — fase 3 + melhorias + e-mail/reativação  

## 2. Edge functions

```bash
supabase functions deploy run-ticket-inactivity-monthly-job
supabase functions deploy run-ticket-inactivity-auto-deactivate-job
supabase functions deploy create-ticket-inactivity-checkout
supabase functions deploy mercadopago-webhook
```

Secrets necessários no projeto Supabase:

- `RESEND_API_KEY`
- `SITE_URL` (ex.: `https://www.eventfest.com.br`)
- Credenciais Mercado Pago (webhook + checkout)
- Opcional: `TICKET_INACTIVITY_JOB_SECRET` (cron externo)

## 3. pg_cron

Criado pelas migrations (se extensão habilitada):

| Job | Quando | Função |
|-----|--------|--------|
| `ticket_inactivity_monthly_check` | Dia 5, 08:00 UTC | `run_ticket_inactivity_check()` |
| `ticket_inactivity_auto_deactivate_daily` | Diário, 09:00 UTC | `run_ticket_inactivity_auto_deactivate()` |

**E-mails:** o SQL do cron só desativa/registra. Para enviar e-mails:

- **Mensal:** Admin → Job completo (edge `run-ticket-inactivity-monthly-job`)  
- **Auto-desativar:** agendar edge `run-ticket-inactivity-auto-deactivate-job` diariamente **ou** botão Admin “Rodar auto-desativação agora”

Verificação rápida: Admin → Preços e comissões → Inatividade → **Verificar deploy** (RPC `verify_anti_fraud_deploy`).

## 4. Front (produção/homologação)

```bash
npm run build
```

Publicar conteúdo de `dist/` no host configurado (Vercel, Netlify, etc.).

Script Windows automatizado:

```powershell
.\scripts\deploy-anti-fraud.ps1
```

## 5. Homologação

Checklist: `docs/CHECKLIST_TESTES_ANTI_FRAUDE.md` (seções A–E).

Destaques fase 4:

- **E10** — E-mail ao gestor após auto-desativar (`auto_deactivated`)  
- **E11** — Venda tardia reativa evento com `auto_deactivated_at`  

## 6. Funcionalidades fase 4 (código)

| Recurso | Comportamento |
|---------|----------------|
| E-mail auto-desativar | Fila `company_ticket_inactivity_notifications` tipo `auto_deactivated` |
| Reativar em venda tardia | Trigger em `receivables` quando pagamento aprovado |
| Verificar deploy | Botão no admin + RPC `verify_anti_fraud_deploy` |
