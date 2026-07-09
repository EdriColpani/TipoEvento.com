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
    const biometricConfirmed = body.biometricConfirmed === true;
    const headerIdempotency = req.headers.get('x-idempotency-key')?.trim() ?? '';
    const bodyIdempotency = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const idempotencyKey = headerIdempotency || bodyIdempotency || crypto.randomUUID();

    if (!intentId) {
      return new Response(JSON.stringify({ error: 'Intenção inválida.' }), { status: 400, headers: corsHeaders });
    }

    const { data: intentData, error: intentErr } = await supabaseAnon.rpc('get_client_credit_consumption_intent', {
      p_intent_id: intentId,
    });
    if (intentErr) throw intentErr;
    const intent = intentData as {
      id: string;
      status: 'pending' | 'completed' | 'cancelled' | 'expired';
      establishment_id: string;
      company_id: string;
      gross_amount: number;
      biometric_required: boolean;
      spend_order_id?: string | null;
      items: Array<{ product_id: string; product_name: string; quantity: number; unit_price: number }>;
    };

    if (!intent?.id) {
      return new Response(JSON.stringify({ error: 'Intenção não encontrada.' }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (intent.status === 'completed' && intent.spend_order_id) {
      const { data: existing } = await supabaseService
        .from('credit_spend_orders')
        .select('id, gross_amount')
        .eq('id', intent.spend_order_id)
        .maybeSingle();
      return new Response(
        JSON.stringify({
          ok: true,
          duplicate: true,
          spendOrderId: intent.spend_order_id,
          grossAmount: Number(existing?.gross_amount ?? intent.gross_amount),
        }),
        { status: 200, headers: corsHeaders },
      );
    }

    if (intent.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Esta intenção não pode mais ser finalizada.' }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    if (intent.biometric_required && !biometricConfirmed) {
      return new Response(
        JSON.stringify({ error: 'Confirmação biométrica obrigatória para este valor.' }),
        { status: 403, headers: corsHeaders },
      );
    }

    const { data: operator, error: operatorErr } = await supabaseService
      .from('user_companies')
      .select('user_id')
      .eq('company_id', intent.company_id)
      .limit(1)
      .maybeSingle();
    if (operatorErr) throw operatorErr;
    if (!operator?.user_id) {
      return new Response(
        JSON.stringify({ error: 'Empresa sem operador válido para processar consumo.' }),
        { status: 503, headers: corsHeaders },
      );
    }

    const itemsPayload = (intent.items ?? []).map((item) => ({
      product_name: String(item.product_name),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      product_id: String(item.product_id),
    }));

    const { data: spendData, error: spendErr } = await supabaseService.rpc('credit_spend_consumption', {
      p_establishment_id: intent.establishment_id,
      p_client_user_id: user.id,
      p_items: itemsPayload,
      p_idempotency_key: idempotencyKey,
      p_actor_user_id: operator.user_id,
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
        biometric_confirmed_at: biometricConfirmed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', intent.id)
      .eq('client_user_id', user.id);

    await supabaseService
      .from('credit_consumption_intent_status_history')
      .insert({
        intent_id: intent.id,
        from_status: previousStatus,
        to_status: 'completed',
        changed_by_user_id: user.id,
        source: 'customer_app',
        notes: 'Cobrança concluída por confirmação direta do cliente',
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
        publicDescription: spend.public_description,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error('[confirm-credit-consumption-intent]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
