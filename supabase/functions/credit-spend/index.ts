import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { finalizeCreditSpendWithMpDisbursement } from '../_shared/credit-mp-disbursement.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
  'Content-Type': 'application/json',
};

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

interface PurchaseItemInput {
  ticketTypeId: string;
  quantity: number;
  price: number;
  name: string;
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
    const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
    const purchaseItems = body.purchaseItems as PurchaseItemInput[] | undefined;
    const spendChannel = body.channel === 'app' ? 'app' : 'web';
    const headerIdempotency = req.headers.get('x-idempotency-key')?.trim() ?? '';
    const bodyIdempotency = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const idempotencyKey = headerIdempotency || bodyIdempotency || crypto.randomUUID();

    if (!eventId) {
      return new Response(JSON.stringify({ error: 'Evento inválido.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!Array.isArray(purchaseItems) || purchaseItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Selecione ao menos um ingresso.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const itemsPayload = purchaseItems
      .filter((item) => item && Number(item.quantity) > 0)
      .map((item) => ({
        wristband_id: String(item.ticketTypeId),
        quantity: Number(item.quantity),
        unit_price: Number(item.price),
        name: String(item.name || 'Ingresso'),
      }));

    if (itemsPayload.length === 0) {
      return new Response(JSON.stringify({ error: 'Itens de compra inválidos.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: eligibility, error: eligErr } = await supabaseAnon.rpc(
      'get_event_credit_payment_eligibility',
      { p_event_id: eventId },
    );
    if (eligErr) throw eligErr;
    if (!eligibility?.eligible) {
      return new Response(
        JSON.stringify({
          error: eligibility?.reason || 'Pagamento com crédito indisponível para este evento.',
        }),
        { status: 403, headers: corsHeaders },
      );
    }

    let receiverCompanyId = eligibility?.company_id as string | undefined;
    if (!receiverCompanyId) {
      const { data: eventRow } = await supabaseService
        .from('events')
        .select('company_id')
        .eq('id', eventId)
        .maybeSingle();
      receiverCompanyId = eventRow?.company_id ?? undefined;
    }

    if (receiverCompanyId) {
      const { data: mpReady, error: mpErr } = await supabaseService.rpc(
        'get_receiver_company_mp_credentials',
        { p_company_id: receiverCompanyId },
      );
      if (mpErr) throw mpErr;
      if (!mpReady?.ok) {
        console.warn(
          '[credit-spend] Empresa sem MP OAuth — crédito segue; liquidação manual D+1.',
          receiverCompanyId,
        );
      }
    }

    const { data: result, error: spendErr } = await supabaseAnon.rpc(
      'credit_spend_ticket_purchase',
      {
        p_event_id: eventId,
        p_items: itemsPayload,
        p_idempotency_key: idempotencyKey,
        p_channel: spendChannel,
      },
    );

    if (spendErr) {
      const msg = spendErr.message || 'Falha ao processar pagamento com crédito.';
      const status = msg.includes('insuficiente') || msg.includes('esgotados') ? 409 : 400;
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: corsHeaders,
      });
    }

    const payload = result as {
      ok?: boolean;
      spend_order_id?: string;
      balance?: number;
      gross_amount?: number;
      platform_amount?: number;
      manager_amount?: number;
      duplicate?: boolean;
      public_description?: string;
      receiver_company_id?: string;
    };

    if (!payload?.ok) {
      return new Response(JSON.stringify({ error: 'Não foi possível concluir a compra com crédito.' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const finalized = await finalizeCreditSpendWithMpDisbursement(
      supabaseService,
      {
        ...payload,
        receiver_company_id: payload.receiver_company_id ?? receiverCompanyId,
      },
      idempotencyKey,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        spendOrderId: finalized.spend_order_id,
        balance: finalized.balance,
        grossAmount: finalized.gross_amount,
        platformAmount: finalized.platform_amount,
        managerAmount: finalized.manager_amount,
        settlementQueued: finalized.settlementQueued === true,
        duplicate: payload.duplicate === true,
        publicDescription: payload.public_description,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error('[credit-spend]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: corsHeaders,
    });
  }
});
