# Inscrição gratuita e envio de e-mail – estado atual

Resumo para retomar o trabalho.

---

## O que já está funcionando

- **Inscrição gratuita**
  - Formulário em `/events/:eventId/inscricao` com todos os campos (nome, CPF, idade, endereço, telefone, e-mail).
  - Máscara de telefone e validação de CPF.
  - Gravação em `event_registrations` com `qr_code` único (UUID) por inscrição.
  - Geração de QR sem depender de `crypto.randomUUID()` (fallback para ambientes antigos).
  - Redirecionamento para `/events/:eventId/inscricao/sucesso` com QR Code na tela e dados do evento.

- **Relatório de inscrições**
  - Card "Relatório de Inscrições" na Central de Relatórios (`/manager/reports`).
  - Página `/manager/reports/registrations`: filtro por evento, busca por nome/CPF/e-mail, tabela com coluna **Confirmado** (leitura), exportação CSV.
  - Coluna `confirmed` em `event_registrations` (migration `event_registrations_add_confirmed.sql`).

- **Edge Function `send-free-registration-email`**
  - Código em `supabase/functions/send-free-registration-email/index.ts`.
  - Recebe: `qrCode`, `email`, `eventTitle`, `eventDate`, `eventTime`, `eventLocation`.
  - Valida inscrição por `qr_code`, envia e-mail via Resend (HTML + QR em imagem), atualiza `email_sent_at`.
  - Deploy: `supabase functions deploy send-free-registration-email`. O arquivo `supabase/config.toml` define `verify_jwt = false` para esta função (evita **401** no browser).
  - Secrets necessárias: `RESEND_API_KEY`, `FREE_EVENTS_FROM_EMAIL` (ex.: `onboarding@resend.dev` para teste).

- **Chamada da função**
  - Na página de sucesso da inscrição (`EventInscriptionSuccessPage.tsx`), um `useEffect` chama `supabase.functions.invoke('send-free-registration-email', { body: { ... } })` ao carregar.

---

## Problema atual: Resend 403

- **Erro no log:** `Resend error: 403` – `"You can only send testing emails to..."`.
- **Causa:** Na conta Resend gratuita, sem domínio verificado, só é permitido enviar para o e-mail do cadastro ou para endereços adicionados como “recipients de teste”.
- **O que fazer para funcionar:**
  1. **Teste rápido:** No painel Resend → Recipients / Testing, adicionar o e-mail de destino como recipient de teste.
  2. **Produção:** Verificar domínio na Resend (DNS), usar remetente do domínio em `FREE_EVENTS_FROM_EMAIL` (ex.: `no-reply@naoresponda.com.br`).

---

## Migrations aplicáveis (se ainda não rodou)

- `supabase/migrations/event_registrations.sql` – tabela de inscrições.
- `supabase/migrations/event_registrations_add_qr_columns.sql` – `qr_code`, `email_sent_at`, `qr_used`.
- `supabase/migrations/event_registrations_add_confirmed.sql` – coluna `confirmed`.

---

## Próximos passos (quando retomar)

1. Configurar recipients de teste na Resend **ou** verificar domínio e ajustar `FREE_EVENTS_FROM_EMAIL`.
2. Testar inscrição completa e conferir se o e-mail chega.
3. (Opcional) Implementar edição do campo **Confirmado** no relatório de inscrições (toggle/checkbox que atualiza `event_registrations.confirmed`).
4. (Fase 2) Integrar validação do QR de inscrição gratuita no fluxo do validador (marcar como utilizado no dia do evento).

---

*Última atualização: contexto da conversa sobre inscrição gratuita e envio de e-mail.*
