# Checklist de testes — Anti-fraude (mínimo de ingressos + inatividade)

**Última atualização:** 2026-06-02  
**Ambiente:** homologação com migrations aplicadas e edge functions publicadas.

## Pré-requisitos de deploy

Aplicar no Supabase, nesta ordem:

1. `20260711120000_min_event_tickets_enforcement.sql`
2. `20260711130000_enforce_min_event_batch_quantity.sql`
3. `20260711140000_event_active_ticket_count_analytics.sql`
4. `20260712120000_ticket_sales_inactivity.sql`
5. `20260713120000_anti_fraud_phase2.sql`
6. `20260713130000_fix_admin_bypass_log_actor_email.sql`
7. `20260713140000_fix_inactivity_job_charge_errors.sql`
8. `20260713150000_fix_jsonb_agg_order_by.sql`
9. `20260714120000_admin_companies_event_ticket_inventory.sql`
10. `20260715120000_anti_fraud_phase3_bypass_log.sql`
11. `20260715130000_anti_fraud_phase3_admin_charges_revenue.sql`
12. `20260715140000_anti_fraud_phase3_auto_deactivate.sql`
14. `20260715160000_anti_fraud_phase4_email_reactivate.sql`

Edge functions:

```bash
supabase functions deploy create-ticket-inactivity-checkout
supabase functions deploy run-ticket-inactivity-monthly-job
supabase functions deploy run-ticket-inactivity-auto-deactivate-job
supabase functions deploy mercadopago-webhook
```

Variáveis: `RESEND_API_KEY`, `SITE_URL`, credenciais MP da plataforma. Opcional: `TICKET_INACTIVITY_JOB_SECRET` para cron externo.

---

## A. Mínimo de ingressos por evento

### A1 — Configuração global e por empresa

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| A1.1 | Admin define mínimo global = 10 em Preços e comissões → Cobrança de ingressos | Salva sem erro | [ ] |
| A1.2 | Nova empresa em plano % ingressos | Herda mínimo 10 | [ ] |
| A1.3 | Admin define override = 15 para empresa X | Coluna mostra 15 + indicador personalizado | [ ] |
| A1.4 | Alterar global para 12 | Empresa X mantém 15; demais não personalizadas passam a 12 | [ ] |
| A1.5 | Restaurar padrão global na empresa X | Volta a 12 (ou global vigente) | [ ] |

### A2 — Criação e lotes

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| A2.1 | Gestor (plano comissão) cria evento com lotes somando &lt; mínimo | Erro ao salvar com número mínimo na mensagem | [ ] |
| A2.2 | Mesmo evento com lotes ≥ mínimo | Salva como rascunho/desativado | [ ] |
| A2.3 | Plano vitrine: criar evento sem lotes pagos | Sem validação de mínimo pago | [ ] |
| A2.4 | Opção “evento gratuito” | Oculta para gestor em planos comissão/híbrido | [ ] |

### A3 — Cadastro de ingressos e ativação

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| A3.1 | Cadastrar ingressos com quantidade &lt; mínimo | Erro ao gravar | [ ] |
| A3.2 | Cadastrar ≥ mínimo com valor &gt; 0 | Grava com sucesso | [ ] |
| A3.3 | Ativar evento na lista sem ingressos suficientes | Erro amigável no toggle | [ ] |
| A3.4 | Ativar com ingressos ≥ mínimo | Ativa na vitrine | [ ] |
| A3.5 | Lista de eventos: evento desativado com poucos ingressos | Badge **Faltam ingressos** + texto com contagem | [ ] |

### A4 — Fluxo pós-criação

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| A4.1 | Após criar evento (plano com ingressos) | Modal sem “Não, voltar”; só fluxo de ingressos | [ ] |
| A4.2 | Clicar fora do modal | Não fecha | [ ] |
| A4.3 | “Ir para ingressos” | Evento pré-selecionado no cadastro | [ ] |

### A5 — Bypass Admin Master (log)

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| A5.1 | Admin Master ativa evento com &lt; mínimo de ingressos | Ativa; entrada no log em Preços e comissões | [ ] |
| A5.2 | Admin Master cria evento com empresa em inatividade | Cria; log `ticket_inactivity_create_event` | [ ] |
| A5.3 | Gestor tenta mesmas ações | Bloqueado (sem bypass) | [ ] |

---

## B. Inatividade de venda de ingressos

### B1 — Detecção e bloqueio (v1)

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| B1.1 | Empresa comissão, evento pago em mar/2026, 0 vendas em mar | Após job de abr: `ticket_inactivity_blocked = true` | [ ] |
| B1.2 | Empresa com ≥1 venda (`receivables` pagos) no mês | Sem bloqueio | [ ] |
| B1.3 | Plano vitrine ou consumo/licença | Ignorado pelo job | [ ] |
| B1.4 | Gestor bloqueado tenta criar evento | Erro de pendência | [ ] |
| B1.5 | Gestor tenta reativar evento | Erro de pendência | [ ] |
| B1.6 | Banner no Dashboard, lista e criar evento | Lista eventos pendentes | [ ] |
| B1.7 | Gestor desativa todos os eventos pendentes ativos | Bloqueio removido automaticamente | [ ] |
| B1.8 | Admin Master “Liberar inatividade” no plano da empresa | Bloqueio removido | [ ] |

### B2 — Job, cron e e-mail (v2)

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| B2.1 | Admin: “Rodar verificação agora” (mês anterior automático) | JSON com eventos/empresas sinalizados | [ ] |
| B2.2 | Admin: “Job completo (verificação + e-mails)” | E-mails na fila enviados via Resend | [ ] |
| B2.3 | Empresa sem `companies.email` | Job roda; notificação não enfileirada (sem erro fatal) | [ ] |
| B2.4 | pg_cron `ticket_inactivity_monthly_check` (dia 5) | Verificar em `cron.job` no Supabase | [ ] |
| B2.5 | Reexecutar job no mesmo mês | Não duplica e-mail já enviado | [ ] |

### B3 — Cobrança após 2 meses consecutivos (v2)

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| B3.1 | Taxa global = R$ 0 | Nenhuma cobrança gerada | [ ] |
| B3.2 | Taxa global = R$ 49; inatividade só em 1 mês | Sem cobrança | [ ] |
| B3.3 | Inatividade em fev e mar (flags em ambos os meses) | Cobrança `pending` em mar | [ ] |
| B3.4 | Gestor: Plano e cobrança → “Pagar taxa de inatividade” | Checkout MP abre | [ ] |
| B3.5 | Pagamento aprovado (webhook) | Cobrança `paid` | [ ] |
| B3.6 | Admin Master bypass em criar/reativar com inatividade | Log registrado | [ ] |

---

## C. Regressão rápida

| # | Área | OK |
|---|------|-----|
| C1 | Compra de ingresso normal (comissão calculada) | [ ] |
| C2 | Mensalidade vitrine e licença consumo (fluxos existentes) | [ ] |
| C3 | Admin Master lista todos os eventos sem deduplicar | [ ] |
| C4 | Build front `npm run build` sem erro | [ ] |

---

## Dados de teste sugeridos

- **Empresa A:** `ticket_commission`, e-mail preenchido, evento 15/03/2026, 0 `receivables` em março.
- **Empresa B:** mesma config, 1 venda paga em março → não deve bloquear.
- **Empresa C:** inatividade em jan e fev → deve gerar cobrança em fev (com taxa &gt; 0).

Para simular vendas: inserir `receivables` com `status = paid` ou `payment_status = approved`, `event_id` e `created_at` no mês de referência.

Para simular job manual sem esperar dia 5: Admin → Preços e comissões → Job completo ou RPC `admin_run_ticket_inactivity_check`.

---

## E. Fase 3 (ver `docs/PLANO_ANTI_FRAUDE_FASE3.md`)

| # | Passo | Resultado esperado | OK |
|---|--------|-------------------|-----|
| E1 | Auto-desativar: evento futuro, 0 vendas | Não desativa antes de `date + X` | [ ] |
| E2 | Auto-desativar: evento há X+1 dias, 0 vendas, ativo | `is_active = false` | [ ] |
| E3 | Admin desliga auto-desativar | Job diário skip | [ ] |
| E4 | Admin cobranças inatividade | Lista `company_ticket_inactivity_charges` | [ ] |
| E5 | Receita admin | Inclui taxas de inatividade pagas | [ ] |
| E6 | Bypass Admin em lote < mínimo | Entrada no log | [ ] |
| E7 | Bypass Admin em cadastro ingresso < mínimo | Entrada no log | [ ] |
| E8 | Job dia 5: vendas no mês anterior à data do evento | Não bloqueia indevidamente | [ ] |
| E9 | Auto-desativar: badge **Inatividade comercial** na lista | Gestor vê motivo | [ ] |
| E10 | Auto-desativar: e-mail ao gestor | Fila `auto_deactivated` + edge job | [ ] |
| E11 | Venda tardia após auto-desativar | Evento reativa (`is_active=true`, limpa `auto_deactivated_at`) | [ ] |
| E12 | Admin → Verificar deploy | RPC `verify_anti_fraud_deploy` retorna OK | [ ] |

---

## Problemas conhecidos / limitações

- `pg_cron` só agenda se a extensão estiver habilitada no projeto Supabase; caso contrário, usar o botão **Job completo** ou agendar a edge function no dashboard.
- E-mail depende de `companies.email` (perfil da empresa).
- Cobrança de inatividade **não** desbloqueia automaticamente a empresa — gestor ainda deve desativar eventos ou Admin liberar.
- Job dia 5 conta vendas **acumuladas até o fim do mês de referência** (migration `20260715150000`); vendas antes da data do evento no mesmo ciclo não geram falso positivo.
