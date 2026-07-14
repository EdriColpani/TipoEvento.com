import {
  processTicketChargebackNotifications,
  verifyTicketChargebackNotifyAuth,
} from '../_shared/ticket-chargeback-notify.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-job-secret',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyTicketChargebackNotifyAuth(
    req.headers.get('Authorization'),
    req.headers.get('x-job-secret'),
  );
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: corsHeaders,
    });
  }

  try {
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const chargebackCaseId = typeof body.chargebackCaseId === 'string' ? body.chargebackCaseId : null;
    const limit = Math.max(1, Math.min(Number(body.limit ?? 50), 100));

    const result = await processTicketChargebackNotifications(auth.supabaseService, {
      chargebackCaseId,
      limit,
    });

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    console.error('[run-ticket-chargeback-notify-job]', e);
    const message = e instanceof Error ? e.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
