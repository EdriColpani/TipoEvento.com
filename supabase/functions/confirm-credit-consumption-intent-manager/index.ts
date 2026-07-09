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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), { status: 401, headers: corsHeaders });
  }

  const supabaseAnon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Sessão inválida.' }), { status: 401, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const intentId = typeof body.intentId === 'string' ? body.intentId.trim() : '';
    const headerIdempotency = req.headers.get('x-idempotency-key')?.trim() ?? '';
    const bodyIdempotency = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const idempotencyKey = headerIdempotency || bodyIdempotency || crypto.randomUUID();

    if (!intentId) {
      return new Response(JSON.stringify({ error: 'Intenção inválida.' }), { status: 400, headers: corsHeaders });
    }

    const { data: intent, error: intentErr } = await supabaseService
      .from('credit_consumption_intents')
      .select(`
        id, client_user_id, company_id, establishment_id, status, gross_amount,
        biometric_required, biometric_confirmed_at, spend_order_id
      `)
      .eq('id', intentId)
      .maybeSingle();
    if (intentErr) throw intentErr;
    if (!intent) {
      return new Response(JSON.stringify({ error: 'Intenção não encontrada.' }), { status: 404, headers: corsHeaders });
    }

    const { data: manages, error: managesErr } = await supabaseService.rpc('user_manages_credit_company', {
      p_company_id: intent.company_id,
      p_user_id: user.id,
    });
    if (managesErr) throw managesErr;
    if (manages !== true) {
      return new Response(JSON.stringify({ error: 'Sem permissão para este estabelecimento.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    if (intent.status === 'completed' && intent.spend_order_id) {
      return new Response(
        JSON.stringify({
          ok: true,
          duplicate: true,
          spendOrderId: intent.spend_order_id,
          grossAmount: Number(intent.gross_amount ?? 0),
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    if (!['new', 'in_preparation', 'ready_for_pickup'].includes(intent.status)) {
      return new Response(JSON.stringify({ error: 'Status do pedido não permite cobrança.' }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    if (intent.biometric_required && !intent.biometric_confirmed_at) {
      return new Response(
        JSON.stringify({ error: 'Pedido requer confirmação biométrica do cliente antes da cobrança.' }),
        { status: 403, headers: corsHeaders },
      );
    }

    const { data: itemsRows, error: itemsErr } = await supabaseService
      .from('credit_consumption_intent_items')
      .select('product_id, product_name, quantity, unit_price')
      .eq('intent_id', intent.id);
    if (itemsErr) throw itemsErr;
    const itemsPayload = (itemsRows ?? []).map((item) => ({
      product_name: String(item.product_name),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      product_id: String(item.product_id),
    }));
    if (itemsPayload.length === 0) {
      return new Response(JSON.stringify({ error: 'Pedido sem itens para cobrança.' }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    const { data: spendData, error: spendErr } = await supabaseService.rpc('credit_spend_consumption', {
      p_establishment_id: intent.establishment_id,
      p_client_user_id: intent.client_user_id,
      p_items: itemsPayload,
      p_idempotency_key: idempotencyKey,
      p_actor_user_id: user.id,
      p_channel: 'customer_app',
    });
    if (spendErr) {
      const msg = spendErr.message || 'Falha ao registrar consumo.';
      const status = msg.includes('insuficiente') ? 409 : 400;
      return new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders });
    }

    const spend = spendData as {
      ok?: boolean;
      spend_order_id?: string;
      balance?: number;
      gross_amount?: number;
      platform_amount?: number;
      manager_amount?: number;
      duplicate?: boolean;
      public_description?: string;
    };

    const finalized = await finalizeCreditSpendWithMpDisbursement(
      supabaseService,
      {
        ...spend,
        receiver_company_id: intent.company_id,
      },
      idempotencyKey,
    );

    const previousStatus = String(intent.status);

    await supabaseService
      .from('credit_consumption_intents')
      .update({
        status: 'completed',
        idempotency_key: idempotencyKey,
        spend_order_id: finalized.spend_order_id ?? spend.spend_order_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', intent.id);

    await supabaseService
      .from('credit_consumption_intent_status_history')
      .insert({
        intent_id: intent.id,
        from_status: previousStatus,
        to_status: 'completed',
        changed_by_user_id: user.id,
        source: 'manager_panel',
        notes: 'Cobrança terminal confirmada no painel de atendimento',
      });

    return new Response(
      JSON.stringify({
        ok: true,
        spendOrderId: finalized.spend_order_id,
        balance: finalized.balance,
        grossAmount: finalized.gross_amount,
        platformAmount: finalized.platform_amount,
        managerAmount: finalized.manager_amount,
        settlementQueued: finalized.settlementQueued === true,
        duplicate: spend.duplicate === true,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error('[confirm-credit-consumption-intent-manager]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
