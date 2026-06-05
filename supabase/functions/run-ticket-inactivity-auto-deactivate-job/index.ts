import {
  buildTicketInactivityEmail,
  fetchPendingInactivityNotifications,
  sendInactivityNotifications,
  type InactivityJobAuth,
  verifyInactivityJobAuth,
} from '../_shared/ticket-inactivity-job.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-job-secret',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  const auth = await verifyInactivityJobAuth(authHeader, req.headers.get('x-job-secret'));
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: corsHeaders,
    });
  }

  try {
    const { supabaseService } = auth as InactivityJobAuth & { ok: true };
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const skipDeactivate = body.skipDeactivate === true;

    let deactivateResult: unknown = null;
    if (!skipDeactivate) {
      const { data, error: deactivateErr } = await supabaseService.rpc('run_ticket_inactivity_auto_deactivate');
      if (deactivateErr) {
        console.error('[run-ticket-inactivity-auto-deactivate-job]', deactivateErr);
        throw new Error(deactivateErr.message ?? 'Falha na auto-desativação.');
      }
      deactivateResult = data;
    }

    const notifications = await fetchPendingInactivityNotifications(supabaseService, 100);
    const autoNotifications = notifications.filter((row) => row.notification_type === 'auto_deactivated');
    const emailResult = await sendInactivityNotifications(
      supabaseService,
      autoNotifications,
      buildTicketInactivityEmail,
    );

    return new Response(
      JSON.stringify({
        success: true,
        deactivate: deactivateResult,
        emails_sent: emailResult.emailsSent,
        emails_failed: emailResult.emailsFailed,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    console.error('[run-ticket-inactivity-auto-deactivate-job]', e);
    const message = e instanceof Error ? e.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
