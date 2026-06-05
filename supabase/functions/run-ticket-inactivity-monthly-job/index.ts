import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { wrapEventFestEmailLayout, sendViaResend } from '../_shared/eventfest-mail.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-job-secret',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

type NotificationRow = {
  id: string;
  company_id: string;
  reference_month: string;
  recipient_email: string;
  notification_type: string;
  payload: Record<string, unknown>;
  company_name?: string;
  trade_name?: string;
};

function formatMonthLabel(referenceMonth: string): string {
  try {
    const d = new Date(`${referenceMonth}T12:00:00`);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  } catch {
    return referenceMonth;
  }
}

function buildEmailHtml(row: NotificationRow): { subject: string; html: string } {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const jobSecret = Deno.env.get('TICKET_INACTIVITY_JOB_SECRET')?.trim();
  const headerSecret = req.headers.get('x-job-secret')?.trim();
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;
  const isJobSecret = Boolean(jobSecret && headerSecret && jobSecret === headerSecret);

  let isAdminMaster = false;
  if (!isServiceRole && !isJobSecret) {
    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida.' }), {
        status: 401,
        headers: corsHeaders,
      });
    }
    const { data: profile } = await supabaseAnon
      .from('profiles')
      .select('tipo_usuario_id')
      .eq('id', user.id)
      .maybeSingle();
    isAdminMaster = profile?.tipo_usuario_id === 1;
  }

  if (!isServiceRole && !isJobSecret && !isAdminMaster) {
    return new Response(JSON.stringify({ error: 'Apenas Admin Master pode executar este job.' }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  try {
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const skipCheck = body.skipCheck === true;
    const referenceMonth = typeof body.referenceMonth === 'string' ? body.referenceMonth : null;

    let checkResult: unknown = null;
    if (!skipCheck) {
      const { data, error: checkErr } = await supabaseService.rpc(
        'run_ticket_inactivity_check',
        { p_reference_month: referenceMonth },
      );
      if (checkErr) {
        console.error('[run-ticket-inactivity-monthly-job] run_ticket_inactivity_check:', checkErr);
        throw new Error(checkErr.message ?? 'Falha na verificação de inatividade.');
      }
      checkResult = data;
    }

    const { data: pendingData, error: pendingErr } = await supabaseService.rpc(
      'get_pending_ticket_inactivity_notifications',
      { p_limit: 100 },
    );
    if (pendingErr) {
      console.error('[run-ticket-inactivity-monthly-job] get_pending:', pendingErr);
      throw new Error(
        pendingErr.message ??
          'Falha ao buscar fila de e-mails. Confirme se a migration 20260713120000 foi aplicada.',
      );
    }

    const notifications = ((pendingData as { notifications?: NotificationRow[] })?.notifications ??
      []) as NotificationRow[];

    let emailsSent = 0;
    let emailsFailed = 0;

    for (const row of notifications) {
      const { subject, html } = buildEmailHtml(row);
      const result = await sendViaResend({
        to: row.recipient_email,
        subject,
        html,
      });

      if (result.ok) {
        await supabaseService.rpc('mark_ticket_inactivity_notification_sent', {
          p_notification_id: row.id,
          p_resend_id: result.id ?? null,
          p_error_message: null,
        });
        emailsSent += 1;
      } else {
        await supabaseService.rpc('mark_ticket_inactivity_notification_sent', {
          p_notification_id: row.id,
          p_resend_id: null,
          p_error_message: result.detail,
        });
        emailsFailed += 1;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        check: checkResult,
        emails_sent: emailsSent,
        emails_failed: emailsFailed,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    console.error('[run-ticket-inactivity-monthly-job]', e);
    const message =
      e instanceof Error
        ? e.message
        : typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
