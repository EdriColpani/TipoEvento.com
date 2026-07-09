import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyWalletQrToken } from '../_shared/wallet-qr-token.ts';
import { finalizeCreditSpendWithMpDisbursement } from '../_shared/credit-mp-disbursement.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
  'Content-Type': 'application/json',
};

interface PdvItemInput {
  productName: string;
  quantity: number;
  unitPrice: number;
  productId?: string;
}

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
    const walletToken = typeof body.walletToken === 'string' ? body.walletToken.trim() : '';
    const establishmentId = typeof body.establishmentId === 'string' ? body.establishmentId.trim() : '';
    const items = body.items as PdvItemInput[] | undefined;
    const headerIdempotency = req.headers.get('x-idempotency-key')?.trim() ?? '';
    const bodyIdempotency = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const idempotencyKey = headerIdempotency || bodyIdempotency || crypto.randomUUID();

    if (!walletToken || !establishmentId) {
      return new Response(JSON.stringify({ error: 'QR da carteira e estabelecimento são obrigatórios.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Adicione ao menos um produto.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const verified = await verifyWalletQrToken(walletToken);
    if (!verified.ok) {
      return new Response(JSON.stringify({ error: verified.message }), {
        status: verified.error_code === 'qr_expired' ? 409 : 400,
        headers: corsHeaders,
      });
    }

    const { data: pdvCtx, error: ctxErr } = await supabaseAnon.rpc('get_establishment_pdv_context', {
      p_establishment_id: establishmentId,
    });
    if (ctxErr) throw ctxErr;
    if (!pdvCtx?.ready) {
      return new Response(
        JSON.stringify({ error: 'Ponto de venda não habilitado para crédito EventFest.' }),
        { status: 403, headers: corsHeaders },
      );
    }

    const receiverCompanyId = pdvCtx?.company_id as string | undefined;
    if (receiverCompanyId) {
      const { data: mpReady, error: mpErr } = await supabaseService.rpc(
        'get_receiver_company_mp_credentials',
        { p_company_id: receiverCompanyId },
      );
      if (mpErr) throw mpErr;
      // OAuth MP do gestor permanece recomendado para ingressos; liquidação de crédito é manual D+1.
      if (!mpReady?.ok) {
        console.warn(
          '[credit-spend-pdv] Empresa sem MP OAuth — crédito PDV segue; liquidação manual D+1.',
          receiverCompanyId,
        );
      }
    }

    const itemsPayload = items
      .filter((item) => item && Number(item.quantity) > 0)
      .map((item) => ({
        product_name: String(item.productName || 'Produto'),
        quantity: Number(item.quantity),
        unit_price: Number(item.unitPrice),
        product_id: item.productId ? String(item.productId) : null,
      }));

    if (itemsPayload.length === 0) {
      return new Response(JSON.stringify({ error: 'Itens inválidos.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: result, error: spendErr } = await supabaseService.rpc('credit_spend_consumption', {
      p_establishment_id: establishmentId,
      p_client_user_id: verified.userId,
      p_items: itemsPayload,
      p_idempotency_key: idempotencyKey,
      p_actor_user_id: user.id,
      p_channel: 'pos',
    });

    if (spendErr) {
      const msg = spendErr.message || 'Falha ao registrar consumo.';
      const status = msg.includes('insuficiente') ? 409 : 400;
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
    };

    if (!payload?.ok) {
      return new Response(JSON.stringify({ error: 'Não foi possível concluir a venda.' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const finalized = await finalizeCreditSpendWithMpDisbursement(
      supabaseService,
      {
        ...payload,
        receiver_company_id: receiverCompanyId,
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
    console.error('[credit-spend-pdv]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: corsHeaders,
    });
  }
});

