import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-worker-token',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const workerToken = (Deno.env.get('WEBHOOK_WORKER_TOKEN') ?? '').trim();
  const auth = (req.headers.get('x-webhook-worker-token') ?? '').trim();
  if (workerToken && auth !== workerToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit ?? 10), 50));

    const { data: jobs, error: claimError } = await supabaseService.rpc('claim_payment_webhook_jobs', {
      p_limit: limit,
    });

    if (claimError) throw claimError;

    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const results: Array<Record<string, unknown>> = [];

    for (const job of jobs ?? []) {
      const jobId = job.id as string;
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/mercadopago-webhook`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'X-Internal-Webhook-Job': jobId,
            'X-Webhook-Worker-Token': workerToken || 'internal',
          },
          body: JSON.stringify({
            _internalJob: true,
            jobId,
            payment: job.payload,
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Webhook processor HTTP ${resp.status}: ${text.slice(0, 300)}`);
        }

        await supabaseService.rpc('complete_payment_webhook_job', {
          p_job_id: jobId,
          p_success: true,
        });

        results.push({ jobId, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabaseService.rpc('complete_payment_webhook_job', {
          p_job_id: jobId,
          p_success: false,
          p_error: msg,
        });
        results.push({ jobId, ok: false, error: msg });
      }
    }

    return new Response(JSON.stringify({
      processed: results.length,
      results,
    }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Internal Server Error',
    }), { status: 500, headers: corsHeaders });
  }
});
