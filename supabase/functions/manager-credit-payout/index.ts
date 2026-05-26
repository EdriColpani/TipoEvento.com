import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { executeCreditMpDisbursement } from '../_shared/credit-mp-disbursement.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

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

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
    const spendOrderId = typeof body.spendOrderId === 'string' ? body.spendOrderId.trim() : '';

    if (!companyId && !spendOrderId) {
      return new Response(JSON.stringify({ error: 'Informe companyId ou spendOrderId.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (companyId) {
      const { data: manages, error: permErr } = await supabaseAnon.rpc('user_manages_credit_company', {
        p_company_id: companyId,
        p_user_id: user.id,
      });
      if (permErr || !manages) {
        return new Response(JSON.stringify({ error: 'Sem permissão para esta empresa.' }), {
          status: 403,
          headers: corsHeaders,
        });
      }
    }

    const { data: queue, error: queueErr } = await supabaseService.rpc(
      'retry_failed_credit_disbursements',
      {
        p_company_id: companyId || null,
        p_limit: spendOrderId ? 1 : 20,
      },
    );
    if (queueErr) throw queueErr;

    const items = ((queue as { items?: Array<Record<string, unknown>> })?.items ?? [])
      .filter((row) => !spendOrderId || row.spend_order_id === spendOrderId);

    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, retried: 0, message: 'Nenhum repasse pendente.' }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const results: Array<{ spendOrderId: string; ok: boolean; mpTransferId?: string; error?: string }> = [];

    for (const row of items) {
      const orderId = String(row.spend_order_id);
      const receiverCompanyId = String(row.receiver_company_id);
      const idempotencyKey = `retry:${orderId}`;

      try {
        const mp = await executeCreditMpDisbursement(supabaseService, {
          spendOrderId: orderId,
          receiverCompanyId,
          grossAmount: Number(row.gross_amount ?? 0),
          platformAmount: Number(row.platform_amount ?? 0),
          managerAmount: Number(row.manager_amount ?? 0),
          idempotencyKey,
          description: 'Retry repasse crédito EventFest',
        });

        const { data: confirmed, error: confirmErr } = await supabaseService.rpc(
          'confirm_credit_mp_disbursement',
          {
            p_spend_order_id: orderId,
            p_mp_transfer_id: mp.mpTransferId,
            p_mp_external_reference: mp.mpExternalReference,
            p_mp_mode: mp.mode,
          },
        );

        if (confirmErr || !(confirmed as { ok?: boolean })?.ok) {
          throw new Error(confirmErr?.message ?? 'Falha ao confirmar repasse.');
        }

        results.push({ spendOrderId: orderId, ok: true, mpTransferId: mp.mpTransferId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro no repasse.';
        await supabaseService.rpc('mark_credit_disbursement_failed', {
          p_spend_order_id: orderId,
          p_error: msg,
        });
        results.push({ spendOrderId: orderId, ok: false, error: msg });
      }
    }

    const okCount = results.filter((r) => r.ok).length;

    return new Response(
      JSON.stringify({
        ok: okCount > 0,
        retried: results.length,
        succeeded: okCount,
        results,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error('[manager-credit-payout]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
