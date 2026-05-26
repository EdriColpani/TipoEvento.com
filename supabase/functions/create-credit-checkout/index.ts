import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getPlatformMpAccessToken } from './mp-token-resolver.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const CREDIT_TOPUP_PREFIX = 'credit_topup:';

const supabaseService = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

function resolveCheckoutOrigin(body: Record<string, unknown>, siteUrlEnv: string): string {
  const envBase = siteUrlEnv.replace(/\/$/, '');
  const raw = typeof body.clientOrigin === 'string' ? body.clientOrigin.trim() : '';
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch {
      /* ignore */
    }
  }
  return envBase;
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
    const amount = Number(body.amount);
    const originCompanyId = (body.originCompanyId as string | undefined) || null;
    const originEventId = (body.originEventId as string | undefined) || null;

    if (!Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Informe um valor de recarga válido.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: validation, error: valErr } = await supabaseAnon.rpc(
      'validate_credit_topup_amount',
      { p_gross_amount: amount },
    );
    if (valErr) throw valErr;
    const v = validation as { ok?: boolean; error?: string };
    if (!v?.ok) {
      return new Response(JSON.stringify({ error: v?.error || 'Valor de recarga não permitido.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: created, error: createErr } = await supabaseAnon.rpc('create_credit_topup_order', {
      p_gross_amount: amount,
      p_origin_company_id: originCompanyId,
      p_origin_event_id: originEventId,
    });
    if (createErr) throw createErr;

    const orderId = (created as { order_id?: string })?.order_id;
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Não foi possível criar o pedido de recarga.' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    let mpAccessToken: string;
    try {
      mpAccessToken = await getPlatformMpAccessToken(supabaseService);
    } catch (credErr) {
      const msg = credErr instanceof Error ? credErr.message : 'Credencial da plataforma não configurada.';
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const siteUrlEnv = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
    const base = resolveCheckoutOrigin(body, siteUrlEnv);
    if (!base) {
      return new Response(JSON.stringify({ error: 'SITE_URL não configurada.' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const grossAmount = Number((created as { gross_paid_amount?: number }).gross_paid_amount ?? amount);
    const externalReference = `${CREDIT_TOPUP_PREFIX}${orderId}`;
    const notificationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mercadopago-webhook`;
    const successUrl = `${base}/wallet?status=success&topup_id=${orderId}`;
    const pendingUrl = `${base}/wallet?status=pending&topup_id=${orderId}`;
    const failureUrl = `${base}/wallet?status=failure&topup_id=${orderId}`;

    const preferenceData = {
      items: [
        {
          title: 'Recarga de crédito EventFest',
          unit_price: grossAmount,
          quantity: 1,
          currency_id: 'BRL',
        },
      ],
      external_reference: externalReference,
      notification_url: notificationUrl,
      back_urls: { success: successUrl, pending: pendingUrl, failure: failureUrl },
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mpAccessToken}`,
      },
      body: JSON.stringify(preferenceData),
    });

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error('[create-credit-checkout] MP error:', errText);
      return new Response(JSON.stringify({ error: 'Falha ao abrir checkout no Mercado Pago.' }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    const mpJson = await mpRes.json();
    if (!mpJson.init_point) {
      return new Response(JSON.stringify({ error: 'URL de pagamento não retornada.' }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    await supabaseService.rpc('attach_credit_topup_mp_preference', {
      p_order_id: orderId,
      p_preference_id: String(mpJson.id),
    });

    return new Response(
      JSON.stringify({
        checkoutUrl: mpJson.init_point,
        orderId,
        grossPaidAmount: grossAmount,
        creditGrantedAmount: grossAmount,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    console.error('[create-credit-checkout]', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Erro interno.' }),
      { status: 500, headers: corsHeaders },
    );
  }
});
