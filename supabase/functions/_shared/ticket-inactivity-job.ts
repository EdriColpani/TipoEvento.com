import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendViaResend, wrapEventFestEmailLayout } from './eventfest-mail.ts';

export type NotificationRow = {
  id: string;
  company_id: string;
  reference_month: string;
  recipient_email: string;
  notification_type: string;
  payload: Record<string, unknown>;
  company_name?: string;
  trade_name?: string;
};

export type InactivityJobAuth =
  | { ok: false; status: number; error: string }
  | { ok: true; supabaseService: SupabaseClient };

function formatMonthLabel(referenceMonth: string): string {
  try {
    const d = new Date(`${referenceMonth}T12:00:00`);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  } catch {
    return referenceMonth;
  }
}

export function buildTicketInactivityEmail(row: NotificationRow): { subject: string; html: string } {
  const companyLabel = row.trade_name || row.company_name || 'sua empresa';
  const monthLabel = formatMonthLabel(row.reference_month);
  const siteUrl = (Deno.env.get('SITE_URL') ?? 'https://www.eventfest.com.br').replace(/\/$/, '');

  if (row.notification_type === 'charge_created') {
    const amount = Number(row.payload?.amount ?? 0);
    const subject = `EventFest — taxa de inatividade comercial (${monthLabel})`;
    const html = wrapEventFestEmailLayout({
      title: 'Taxa de inatividade comercial',
      intro:
        `Identificamos inatividade comercial em dois meses consecutivos para <strong>${companyLabel}</strong> ` +
        `(referência: ${monthLabel}). Foi gerada uma cobrança de <strong>R$ ${amount.toFixed(2).replace('.', ',')}</strong>.`,
      ctaLabel: 'Pagar no painel do gestor',
      ctaUrl: `${siteUrl}/manager/settings/company-profile?tab=billing`,
      footerNote: 'Regularize a pendência desativando eventos sem venda ou entre em contato com o suporte EventFest.',
    });
    return { subject, html };
  }

  if (row.notification_type === 'auto_deactivated') {
    const eventTitle = String(row.payload?.event_title ?? 'Evento');
    const eventDate = String(row.payload?.event_date ?? '');
    const daysAfter = Number(row.payload?.days_after ?? 0);
    const subject = `EventFest — evento desativado por inatividade comercial`;
    const html = wrapEventFestEmailLayout({
      title: 'Evento desativado automaticamente',
      intro:
        `O evento <strong>${eventTitle}</strong> (${eventDate ? `realizado em ${eventDate}` : 'sem vendas registradas'}) ` +
        `de <strong>${companyLabel}</strong> foi retirado da vitrine após <strong>${daysAfter} dias</strong> sem venda de ingressos.`,
      ctaLabel: 'Ver meus eventos',
      ctaUrl: `${siteUrl}/manager/events`,
      footerNote:
        'Se houve venda tardia, o sistema pode reativar o evento automaticamente. Caso contrário, reative manualmente na lista de eventos.',
    });
    return { subject, html };
  }

  const subject = `EventFest — pendência de inatividade comercial (${monthLabel})`;
  const html = wrapEventFestEmailLayout({
    title: 'Pendência de inatividade comercial',
    intro:
      `Há evento(s) realizados em <strong>${monthLabel}</strong> sem venda de ingressos para <strong>${companyLabel}</strong>. ` +
      'Enquanto a pendência não for resolvida, não será possível criar novos eventos nem reativar eventos na vitrine.',
    ctaLabel: 'Ver meus eventos',
    ctaUrl: `${siteUrl}/manager/events`,
    footerNote: 'Desative os eventos pendentes na lista de eventos ou solicite liberação ao suporte EventFest.',
  });
  return { subject, html };
}

export async function verifyInactivityJobAuth(
  authHeader: string | null,
  headerSecret: string | null,
): Promise<InactivityJobAuth> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Não autorizado.' };
  }

  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const jobSecret = Deno.env.get('TICKET_INACTIVITY_JOB_SECRET')?.trim();
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

export async function fetchPendingInactivityNotifications(
  supabaseService: SupabaseClient,
  limit = 100,
): Promise<NotificationRow[]> {
  const { data: pendingData, error: pendingErr } = await supabaseService.rpc(
    'get_pending_ticket_inactivity_notifications',
    { p_limit: limit },
  );
  if (pendingErr) {
    throw new Error(pendingErr.message ?? 'Falha ao buscar fila de e-mails.');
  }
  return ((pendingData as { notifications?: NotificationRow[] })?.notifications ?? []) as NotificationRow[];
}

export async function sendInactivityNotifications(
  supabaseService: SupabaseClient,
  notifications: NotificationRow[],
  buildEmail: (row: NotificationRow) => { subject: string; html: string },
): Promise<{ emailsSent: number; emailsFailed: number }> {
  let emailsSent = 0;
  let emailsFailed = 0;

  for (const row of notifications) {
    const { subject, html } = buildEmail(row);
    const result = await sendViaResend({ to: row.recipient_email, subject, html });

    await supabaseService.rpc('mark_ticket_inactivity_notification_sent', {
      p_notification_id: row.id,
      p_resend_id: result.ok ? result.id ?? null : null,
      p_error_message: result.ok ? null : result.detail,
    });

    if (result.ok) emailsSent += 1;
    else emailsFailed += 1;
  }

  return { emailsSent, emailsFailed };
}
