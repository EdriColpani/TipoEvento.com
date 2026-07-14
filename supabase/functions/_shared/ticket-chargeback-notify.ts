import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendViaResend, wrapEventFestEmailLayout } from './eventfest-mail.ts';

export type TicketChargebackNotifyRow = {
  id: string;
  receivable_id: string;
  event_id: string | null;
  company_id: string | null;
  client_user_id: string | null;
  manager_user_id: string | null;
  mp_payment_id: string;
  mp_status: string;
  gross_amount: number;
  platform_fee_amount: number;
  manager_net_amount: number;
  tickets_cancelled_count: number;
  already_checked_in: boolean;
  needs_manual_review: boolean;
  reason: string;
  created_at: string;
  manager_notified_at: string | null;
  admin_notified_at: string | null;
  event_title: string | null;
  company_name: string | null;
  company_email: string | null;
  manager_email: string | null;
  client_email: string | null;
  billing_plan?: string | null;
  debt_id?: string | null;
  recovery_mode?: string | null;
  payment_ref_hint?: string | null;
};

function moneyBr(value: number): string {
  return Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function buildManagerEmail(row: TicketChargebackNotifyRow): { subject: string; html: string } {
  const amount = moneyBr(Number(row.manager_net_amount));
  const eventLabel = row.event_title || 'Evento';
  const recovery = row.recovery_mode === 'credit_settlement_offset'
    ? 'credit_settlement_offset'
    : 'manual_pix';
  const refHint = row.payment_ref_hint || 'EF-TCB-…';

  const subject = recovery === 'manual_pix'
    ? `EventFest — Chargeback ingresso: devolva ${amount} via PIX/TED`
    : `EventFest — Chargeback ingresso: desconto de ${amount} no repasse`;

  const recoveryBlock = recovery === 'manual_pix'
    ? `<p style="margin:0 0 12px;font-size:14px;color:#fbbf24;">
  <strong>Como pagar:</strong> como sua empresa opera só com venda de ingressos (sem repasse de crédito D+1),
  devolva <strong>${amount}</strong> à EventFest via <strong>PIX ou TED</strong>.
  Use a referência <strong style="font-family:monospace;">${refHint}</strong> no comprovante e aguarde a confirmação do Admin.
</p>
<p style="margin:0;font-size:13px;color:#a3a3a3;">Os dados da chave PIX EventFest estão no painel do gestor em Relatórios → Chargebacks de ingresso.</p>`
    : `<p style="margin:0;font-size:13px;color:#a3a3a3;">Esse valor será descontado automaticamente nos próximos repasses (liquidação D+1 de crédito), até a quitação.</p>`;

  const extraHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;font-size:14px;color:#d4d4d4;">
  <tr><td style="padding:4px 0;color:#737373;width:42%;">Data</td><td>${formatDt(row.created_at)}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Evento</td><td>${eventLabel}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Cliente</td><td>${row.client_email || row.client_user_id || '—'}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Status MP</td><td>${row.mp_status}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Pagamento MP</td><td style="font-family:monospace;font-size:12px;">${row.mp_payment_id}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Valor bruto</td><td>${moneyBr(Number(row.gross_amount))}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;"><strong style="color:#fbbf24;">Valor a quitar</strong></td><td><strong style="color:#fbbf24;">${amount}</strong></td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Referência</td><td style="font-family:monospace;font-size:12px;">${refHint}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Ingressos cancelados</td><td>${row.tickets_cancelled_count}</td></tr>
</table>
${recoveryBlock}
<p style="margin:12px 0 0;font-size:13px;color:#a3a3a3;">${row.reason}</p>`;

  const html = wrapEventFestEmailLayout({
    title: recovery === 'manual_pix'
      ? 'Chargeback de ingresso — devolução via PIX/TED'
      : 'Chargeback de ingresso — desconto no repasse',
    intro:
      `O cliente solicitou chargeback/estorno de um ingresso em <strong>${eventLabel}</strong>. ` +
      `O ingresso foi invalidado. Valor a quitar: <strong style="color:#fbbf24;">${amount}</strong>.`,
    extraHtml,
    footerNote: 'Alerta automático EventFest — chargeback Mercado Pago em venda de ingresso.',
  });

  return { subject, html };
}

function buildAdminEmail(
  row: TicketChargebackNotifyRow,
  adminUrl: string,
): { subject: string; html: string } {
  const amount = moneyBr(Number(row.manager_net_amount));
  const subject = `EventFest — Chargeback ingresso ${row.event_title || row.mp_payment_id}`;

  const extraHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;font-size:14px;color:#d4d4d4;">
  <tr><td style="padding:4px 0;color:#737373;width:42%;">Empresa</td><td>${row.company_name || row.company_id || '—'}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Evento</td><td>${row.event_title || '—'}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Dívida gestor</td><td>${amount}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Fee plataforma</td><td>${moneyBr(Number(row.platform_fee_amount))}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Revisão manual</td><td>${row.needs_manual_review ? 'SIM' : 'não'}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Já validado</td><td>${row.already_checked_in ? 'SIM' : 'não'}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">MP ID</td><td style="font-family:monospace;font-size:12px;">${row.mp_payment_id}</td></tr>
</table>`;

  const html = wrapEventFestEmailLayout({
    title: 'Chargeback de ingresso registrado',
    intro:
      'Um chargeback/refund de venda de ingresso foi processado. Ingressos cancelados (quando aplicável) e débito criado para desconto no repasse.',
    ctaLabel: 'Ver chargebacks de crédito/ingressos',
    ctaUrl: adminUrl,
    extraHtml,
    footerNote: 'Alerta automático EventFest — admin chargeback ingresso.',
  });

  return { subject, html };
}

export async function verifyTicketChargebackNotifyAuth(
  authHeader: string | null,
  headerSecret: string | null,
): Promise<{ ok: false; status: number; error: string } | { ok: true; supabaseService: SupabaseClient }> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Não autorizado.' };
  }

  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const jobSecret = Deno.env.get('TICKET_CHARGEBACK_NOTIFY_JOB_SECRET')?.trim()
    || Deno.env.get('CREDIT_CHARGEBACK_NOTIFY_JOB_SECRET')?.trim();
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;
  const isJobSecret = Boolean(jobSecret && headerSecret?.trim() && jobSecret === headerSecret.trim());

  if (isServiceRole || isJobSecret) {
    return { ok: true, supabaseService };
  }

  const supabaseAnon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
  if (userError || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida.' };
  }
  const { data: profile } = await supabaseAnon
    .from('profiles')
    .select('tipo_usuario_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.tipo_usuario_id !== 1) {
    return { ok: false, status: 403, error: 'Apenas Admin Master pode executar este job.' };
  }

  return { ok: true, supabaseService };
}

async function resolveAdminEmails(supabaseService: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabaseService.rpc('get_admin_master_notification_emails');
  if (error) {
    console.error('[ticket-chargeback-notify] get_admin_master_notification_emails:', error);
  }
  const fromDb = Array.isArray(data) ? data.map((e) => String(e).trim().toLowerCase()) : [];
  const raw = (Deno.env.get('TICKET_CHARGEBACK_ALERT_EMAILS') ?? Deno.env.get('CREDIT_CHARGEBACK_ALERT_EMAILS') ?? '').trim();
  const extra = raw ? raw.split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean) : [];
  return [...new Set([...fromDb, ...extra])].filter(Boolean);
}

export async function processTicketChargebackNotifications(
  supabaseService: SupabaseClient,
  options: { chargebackCaseId?: string | null; limit?: number },
): Promise<{ emailsSent: number; emailsFailed: number; casesProcessed: number }> {
  const siteUrl = (Deno.env.get('SITE_URL') ?? 'https://www.eventfest.com.br').replace(/\/$/, '');
  const adminUrl = `${siteUrl}/admin/settings/credit-reports`;

  const { data: pendingData, error: pendingErr } = await supabaseService.rpc(
    'get_pending_ticket_chargeback_notifications',
    {
      p_limit: options.limit ?? 50,
      p_chargeback_case_id: options.chargebackCaseId ?? null,
    },
  );
  if (pendingErr) {
    throw new Error(pendingErr.message ?? 'Falha ao buscar chargebacks de ingresso pendentes.');
  }

  const rows = ((pendingData as { items?: TicketChargebackNotifyRow[] })?.items ?? []) as TicketChargebackNotifyRow[];
  if (rows.length === 0) {
    return { emailsSent: 0, emailsFailed: 0, casesProcessed: 0 };
  }

  const adminRecipients = await resolveAdminEmails(supabaseService);
  let emailsSent = 0;
  let emailsFailed = 0;

  for (const row of rows) {
    if (!row.manager_notified_at) {
      const managerTargets = [...new Set(
        [row.manager_email, row.company_email]
          .map((e) => (e || '').trim().toLowerCase())
          .filter(Boolean),
      )];

      if (managerTargets.length === 0) {
        await supabaseService.rpc('mark_ticket_chargeback_notified', {
          p_case_id: row.id,
          p_audience: 'manager',
          p_resend_id: null,
          p_error_message: 'Sem e-mail de gestor/empresa.',
        });
      } else {
        const { subject, html } = buildManagerEmail(row);
        let ok = false;
        let lastId: string | undefined;
        let lastError: string | undefined;
        for (const to of managerTargets) {
          const result = await sendViaResend({ to, subject, html });
          if (result.ok) {
            ok = true;
            lastId = result.id;
            emailsSent += 1;
          } else {
            lastError = result.detail;
            emailsFailed += 1;
          }
        }
        await supabaseService.rpc('mark_ticket_chargeback_notified', {
          p_case_id: row.id,
          p_audience: 'manager',
          p_resend_id: ok ? lastId ?? null : null,
          p_error_message: ok ? null : lastError ?? 'Falha ao enviar e-mail ao gestor.',
        });
      }
    }

    if (!row.admin_notified_at) {
      if (adminRecipients.length === 0) {
        await supabaseService.rpc('mark_ticket_chargeback_notified', {
          p_case_id: row.id,
          p_audience: 'admin',
          p_resend_id: null,
          p_error_message: 'Sem e-mail de Admin Master.',
        });
      } else {
        const { subject, html } = buildAdminEmail(row, adminUrl);
        let ok = false;
        let lastId: string | undefined;
        let lastError: string | undefined;
        for (const to of adminRecipients) {
          const result = await sendViaResend({ to, subject, html });
          if (result.ok) {
            ok = true;
            lastId = result.id;
            emailsSent += 1;
          } else {
            lastError = result.detail;
            emailsFailed += 1;
          }
        }
        await supabaseService.rpc('mark_ticket_chargeback_notified', {
          p_case_id: row.id,
          p_audience: 'admin',
          p_resend_id: ok ? lastId ?? null : null,
          p_error_message: ok ? null : lastError ?? 'Falha ao enviar e-mail ao admin.',
        });
      }
    }
  }

  return { emailsSent, emailsFailed, casesProcessed: rows.length };
}

export async function triggerTicketChargebackNotifyFromWebhook(
  _supabaseService: SupabaseClient,
  chargebackCaseId: string | null | undefined,
): Promise<void> {
  if (!chargebackCaseId) return;

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return;

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/run-ticket-chargeback-notify-job`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chargebackCaseId, limit: 1 }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn('[MP Webhook] ticket chargeback notify failed:', resp.status, text.slice(0, 300));
    }
  } catch (err) {
    console.warn('[MP Webhook] ticket chargeback notify error:', err);
  }
}
