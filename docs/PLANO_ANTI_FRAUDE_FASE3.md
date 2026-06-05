# Plano de ação — Fase 3 anti-fraude (itens pendentes)

**Status:** Implementado  
**Última atualização:** 2026-06-02  
**Pré-requisito:** Fases 1–2 de mínimo de ingressos e inatividade já deployadas e homologadas (`docs/CHECKLIST_TESTES_ANTI_FRAUDE.md`)

---

## Contexto (decisões já alinhadas)

| Tema | Decisão |
|------|---------|
| Job dia 5 | Já existe; Admin liga/desliga via `ticket_inactivity_enabled` |
| Auto-desativar | **Nova** regra; Admin liga/desliga + dias configuráveis |
| Contagem de dias (auto-desativar) | A partir da **`events.date`**, somente **após** o evento ter ocorrido |
| Auto-desativar vs bloqueio | Só `is_active = false`; bloqueio formal permanece no job dia 5 |
| Dias default sugeridos | **30** (Admin pode usar 60 ou outro valor; **0 = desligado**) |
| Evento futuro / divulgação | Auto-desativar **não** age antes de `date + X dias` |

---

## Escopo da fase 3 (4 itens)

| # | Item | Prioridade | Esforço |
|---|------|------------|---------|
| 3.1 | Auto-desativar eventos sem venda após X dias pós-data | Alta | Médio |
| 3.2 | Tela admin cobranças de inatividade | Média | Baixo |
| 3.3 | Receita admin incluir taxa de inatividade | Média | Baixo |
| 3.4 | Log bypass em lotes e cadastro de ingressos | Baixa | Baixo |

Ordem sugerida de implementação: **3.4 → 3.2 → 3.3 → 3.1** (menor risco primeiro; auto-desativar por último por impacto em produção).

---

## 3.1 — Auto-desativar vitrine após X dias

### Objetivo

Reduzir uso gratuito da plataforma (vitrine, checkout, validação) em eventos já realizados sem nenhuma venda, **sem** depender do calendário mensal do dia 5.

### Regras de negócio

1. Só planos `ticket_commission` e `ticket_plus_consumption`.
2. Evento pago, não `listing_only`, `is_active = true`.
3. `CURRENT_DATE >= events.date + X dias` (fuso America/Sao_Paulo).
4. Zero vendas pagas (`receivables`) vinculadas ao evento — **critério a implementar:** total desde criação do evento (recomendado) ou janela explícita de vendas.
5. Ação: `UPDATE events SET is_active = false` + registro em log (`admin_master_bypass_log` ou tabela `event_auto_deactivate_log`).
6. **Não** alterar `ticket_inactivity_blocked` neste job.

### Configuração Admin Master

Adicionar em `TicketInactivityAdminSection` (mesma seção de inatividade):

- Checkbox: **Ativar desativação automática de vitrine**
- Input numérico: **Dias após a data do evento** (default **30**, min 0; 0 = off mesmo com checkbox)

Colunas sugeridas em `system_billing_settings`:

- `ticket_inactivity_auto_deactivate_enabled BOOLEAN DEFAULT false`
- `ticket_inactivity_auto_deactivate_days INTEGER DEFAULT 30 CHECK (>= 0 AND <= 365)`

### Backend

- RPC `run_ticket_inactivity_auto_deactivate()` — idempotente, retorna JSON com eventos desativados.
- Cron `pg_cron` diário (ex.: 06:00 BRT) ou edge function agendada.
- Respeitar `ticket_inactivity_auto_deactivate_enabled`; se false, skip.

### Front gestor (opcional v1)

- Badge ou tooltip em evento desativado automaticamente (“Desativado por inatividade comercial”).

### Testes

- Evento daqui 60 dias, 0 vendas → **não** desativa.
- Evento há 31 dias, 0 vendas, ativo → desativa (com X=30).
- Evento há 31 dias, 1 venda → **não** desativa.
- Admin desliga regra → job skip.
- Admin define X=60 → desativa só após 60 dias.

---

## 3.2 — Tela admin cobranças de inatividade

### Objetivo

Espelhar operação já existente para mensalidade vitrine e licença consumo.

### Onde

Estender `AdminListingMonthlyBilling` (ou aba dedicada) com seção **Taxas de inatividade**:

- Listar `company_ticket_inactivity_charges` (empresa, mês referência, valor, status, MP)
- Filtros: status, empresa, período
- Ações Admin: marcar pago manualmente (se aplicável), link para detalhe da empresa

### Backend

- Reutilizar tabela e RPCs existentes; criar `admin_list_ticket_inactivity_charges(p_filters)` se a listagem atual for insuficiente.

### Testes

- Cobrança `pending` aparece na lista
- Após webhook MP → `paid`
- Admin marca pago manual → status atualizado

---

## 3.3 — Receita admin incluir taxa de inatividade

### Objetivo

Dashboard/receita da plataforma refletir receita de `company_ticket_inactivity_charges` pagas.

### Onde

- Migration alterando `get_admin_platform_billing_revenue` (ou RPC equivalente)
- UI em relatório admin de receita, se houver breakdown por tipo

### Regra

Somar cobranças com `status = 'paid'` no período filtrado, mesmo padrão de vitrine/licença.

### Testes

- Período com cobrança paga → total incrementa
- Período sem cobrança → inalterado

---

## 3.4 — Log bypass em lotes e cadastro de ingressos

### Objetivo

Auditoria completa quando Admin Master contorna validações anti-fraude.

### Hoje

Log registrado em: ativar evento, criar evento com empresa bloqueada.

### Falta

| Ação | Onde instrumentar |
|------|-------------------|
| Salvar lote abaixo do mínimo | Trigger `event_batches` + `admin_master_bypass_log` |
| Cadastrar ingressos abaixo do mínimo | Trigger `wristband_analytics` / RPC de insert |

### Front

- `AdminMasterBypassLogSection`: novos `action_type` na listagem (filtro opcional).

### Testes

- Admin salva lote < mínimo → entrada no log
- Gestor → bloqueado sem log
- Admin cadastra < mínimo → entrada no log

---

## Deploy fase 3 (quando implementado)

### Migrations (previstas)

1. `20260715120000_ticket_inactivity_auto_deactivate.sql` (3.1 + settings)
2. `20260715130000_admin_inactivity_charges_list.sql` (3.2, se necessário)
3. `20260715140000_platform_revenue_inactivity_fee.sql` (3.3)
4. `20260715150000_bypass_log_batches_wristbands.sql` (3.4)

### Edge functions

- Nova ou estender cron para auto-desativar (se não usar só pg_cron)

### Checklist

Atualizar `docs/CHECKLIST_TESTES_ANTI_FRAUDE.md` com seção **E. Fase 3**.

---

## Fora de escopo (melhoria futura)

- Job dia 5: contar vendas **acumuladas até a data do evento** (corrige falso positivo vendas no mês anterior à data)
- E-mail ao gestor quando auto-desativar vitrine
- Reativar automaticamente se houver venda tardia (webhook)
