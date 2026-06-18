import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendViaResend, wrapEventFestEmailLayout } from './eventfest-mail.ts';

export type ChargebackNotifyRow = {
  id: string;
  topup_order_id: string;
  client_user_id: string;
  mp_payment_id: string;
  mp_status: string;
  credit_granted_amount: number;
  wallet_debit: number;
  clawback_manager_total: number;
  platform_absorb: number;
  clawback_settlement_count: number;
  reason: string;
  created_at: string;
  gross_paid_amount: number | null;
  origin_company_id: string | null;
  origin_company_name: string | null;
};

export type ChargebackNotifyAuth =
  | { ok: false; status: number; error: string }
  | { ok: true; supabaseService: SupabaseClient };

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

export function buildChargebackAbsorbEmail(
  row: ChargebackNotifyRow,
  adminUrl: string,
): { subject: string; html: string } {
  const absorb = moneyBr(Number(row.platform_absorb));
  const subject = `EventFest — Chargeback recarga: absorção ${absorb}`;

  const extraHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;font-size:14px;color:#d4d4d4;">
  <tr><td style="padding:4px 0;color:#737373;width:42%;">Data</td><td>${formatDt(row.created_at)}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Status MP</td><td>${row.mp_status}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Pagamento MP</td><td style="font-family:monospace;font-size:12px;">${row.mp_payment_id}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Crédito concedido</td><td>${moneyBr(Number(row.credit_granted_amount))}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Recuperado carteira</td><td>${moneyBr(Number(row.wallet_debit))}</td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Clawback gestores</td><td>${moneyBr(Number(row.clawback_manager_total))} (${row.clawback_settlement_count})</td></tr>
  <tr><td style="padding:4px 0;color:#737373;"><strong style="color:#f87171;">Absorção EventFest</strong></td><td><strong style="color:#f87171;">${absorb}</strong></td></tr>
  <tr><td style="padding:4px 0;color:#737373;">Cliente</td><td style="font-family:monospace;font-size:11px;">${row.client_user_id}</td></tr>
</table>
<p style="margin:0;font-size:13px;color:#a3a3a3;">${row.reason}</p>`;

  const html = wrapEventFestEmailLayout({
    title: 'Chargeback com absorção EventFest',
    intro:
      `Um chargeback/refund na recarga de crédito gerou <strong style="color:#f87171;">${absorb}</strong> ` +
      'de perda não recuperada do cliente nem dos gestores. Revise o caso no painel admin.',
    ctaLabel: 'Ver chargebacks',
    ctaUrl: adminUrl,
    extraHtml,
    footerNote: 'Alerta automático EventFest — recarga de crédito / chargeback Mercado Pago.',
  });

  return { subject, html };
}

export function buildChargebackDigestEmail(
  rows: ChargebackNotifyRow[],
  adminUrl: string,
): { subject: string; html: string } {
  const totalAbsorb = rows.reduce((sum, row) => sum + Number(row.platform_absorb ?? 0), 0);
  const subject = `EventFest — ${rows.length} chargeback(s) com absorção (${moneyBr(totalAbsorb)})`;

  const lines = rows
    .map((row) => {
      return `<tr>
  <td style="padding:8px;border-bottom:1px solid rgba(234,179,8,0.15);font-size:12px;color:#a3a3a3;">${formatDt(row.created_at)}</td>
  <td style="padding:8px;border-bottom:1px solid rgba(234,179,8,0.15);font-size:12px;color:#d4d4d4;text-align:right;">${moneyBr(Number(row.platform_absorb))}</td>
  <td style="padding:8px;border-bottom:1px solid rgba(234,179,8,0.15);font-size:11px;font-family:monospace;color:#737373;">${row.mp_payment_id}</td>
</tr>`;
    })
    .join('');

  const extraHtml = `<p style="margin:0 0 12px;font-size:14px;color:#d4d4d4;">
  Total de absorção pendente de revisão: <strong style="color:#f87171;">${moneyBr(totalAbsorb)}</strong>
</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;">
  <tr>
    <th align="left" style="padding:8px;font-size:11px;color:#737373;text-transform:uppercase;">Data</th>
    <th align="right" style="padding:8px;font-size:11px;color:#737373;text-transform:uppercase;">Absorção</th>
    <th align="left" style="padding:8px;font-size:11px;color:#737373;text-transform:uppercase;">MP ID</th>
  </tr>
  ${lines}
</table>`;

  const html = wrapEventFestEmailLayout({
    title: 'Resumo diário — chargebacks com absorção',
    intro: `Há <strong>${rows.length}</strong> caso(s) de chargeback de recarga com absorção EventFest aguardando revisão.`,
    ctaLabel: 'Abrir relatório de chargebacks',
    ctaUrl: adminUrl,
    extraHtml,
    footerNote: 'Resumo automático EventFest — execute revisão financeira e conciliação MP.',
  });

  return { subject, html };
}

export async function verifyChargebackNotifyAuth(
  authHeader: string | null,
  headerSecret: string | null,
): Promise<ChargebackNotifyAuth> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Não autorizado.' };
  }

  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const jobSecret = Deno.env.get('CREDIT_CHARGEBACK_NOTIFY_JOB_SECRET')?.trim();
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

function parseExtraAlertEmails(): string[] {
  const raw = (Deno.env.get('CREDIT_CHARGEBACK_ALERT_EMAILS') ?? '').trim();
  if (!raw) return [];
  return raw.split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

async function resolveRecipientEmails(supabaseService: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabaseService.rpc('get_admin_master_notification_emails');
  if (error) {
    console.error('[chargeback-notify] get_admin_master_notification_emails:', error);
  }
  const fromDb = Array.isArray(data) ? data.map((e) => String(e).trim().toLowerCase()) : [];
  const merged = new Set<string>([...fromDb, ...parseExtraAlertEmails()]);
  return [...merged].filter(Boolean);
}

export async function processCreditTopupChargebackNotifications(
  supabaseService: SupabaseClient,
  options: { chargebackCaseId?: string | null; limit?: number; digestMode?: boolean },
): Promise<{ emailsSent: number; emailsFailed: number; casesProcessed: number }> {
  const siteUrl = (Deno.env.get('SITE_URL') ?? 'https://www.eventfest.com.br').replace(/\/$/, '');
  const adminUrl = `${siteUrl}/admin/settings/credit-reports`;

  const { data: pendingData, error: pendingErr } = await supabaseService.rpc(
    'get_pending_credit_topup_chargeback_admin_notifications',
    {
      p_limit: options.limit ?? 50,
      p_chargeback_case_id: options.chargebackCaseId ?? null,
    },
  );
  if (pendingErr) {
    throw new Error(pendingErr.message ?? 'Falha ao buscar chargebacks pendentes.');
  }

  const rows = ((pendingData as { items?: ChargebackNotifyRow[] })?.items ?? []) as ChargebackNotifyRow[];
  if (rows.length === 0) {
    return { emailsSent: 0, emailsFailed: 0, casesProcessed: 0 };
  }

  const recipients = await resolveRecipientEmails(supabaseService);
  if (recipients.length === 0) {
    throw new Error('Nenhum e-mail de Admin Master configurado para alertas.');
  }

  let emailsSent = 0;
  let emailsFailed = 0;

  if (options.digestMode && rows.length > 1) {
    const { subject, html } = buildChargebackDigestEmail(rows, adminUrl);
    let digestOk = false;
    let lastResendId: string | undefined;
    let lastError: string | undefined;

    for (const to of recipients) {
      const result = await sendViaResend({ to, subject, html });
      if (result.ok) {
        digestOk = true;
        lastResendId = result.id;
        emailsSent += 1;
      } else {
        lastError = result.detail;
        emailsFailed += 1;
      }
    }

    for (const row of rows) {
      await supabaseService.rpc('mark_credit_topup_chargeback_admin_notified', {
        p_case_id: row.id,
        p_resend_id: digestOk ? lastResendId ?? null : null,
        p_error_message: digestOk ? null : lastError ?? 'Falha ao enviar digest.',
      });
    }

    return { emailsSent, emailsFailed, casesProcessed: rows.length };
  }

  for (const row of rows) {
    const { subject, html } = buildChargebackAbsorbEmail(row, adminUrl);
    let caseOk = false;
    let lastResendId: string | undefined;
    let lastError: string | undefined;

    for (const to of recipients) {
      const result = await sendViaResend({ to, subject, html });
      if (result.ok) {
        caseOk = true;
        lastResendId = result.id;
        emailsSent += 1;
      } else {
        lastError = result.detail;
        emailsFailed += 1;
      }
    }

    await supabaseService.rpc('mark_credit_topup_chargeback_admin_notified', {
      p_case_id: row.id,
      p_resend_id: caseOk ? lastResendId ?? null : null,
      p_error_message: caseOk ? null : lastError ?? 'Falha ao enviar alerta.',
    });
  }

  return { emailsSent, emailsFailed, casesProcessed: rows.length };
}

export async function triggerChargebackNotifyFromWebhook(
  supabaseService: SupabaseClient,
  chargebackCaseId: string | null | undefined,
  platformAbsorb: number,
): Promise<void> {
  if (!chargebackCaseId || Number(platformAbsorb) <= 0) return;

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return;

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/run-credit-chargeback-notify-job`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chargebackCaseId, limit: 1 }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn('[MP Webhook] chargeback notify failed:', resp.status, text.slice(0, 300));
    }
  } catch (err) {
    console.warn('[MP Webhook] chargeback notify error:', err);
  }
}
