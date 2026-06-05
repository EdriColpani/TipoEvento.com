import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getPlatformMpAccessToken } from '../_shared/mp-token-resolver.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

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
      if (u.protocol === 'https:') return u.origin;
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
    const companyId = body.companyId as string | undefined;
    const chargeIdInput = body.chargeId as string | undefined;

    if (!companyId) {
      return new Response(JSON.stringify({ error: 'companyId é obrigatório.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: canManage, error: canManageErr } = await supabaseAnon.rpc(
      'user_can_manage_company_billing',
      { p_company_id: companyId },
    );
    if (canManageErr) {
      console.error('[create-ticket-inactivity-checkout] canManage:', canManageErr);
      return new Response(JSON.stringify({ error: 'Não foi possível validar permissão.' }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    if (!canManage) {
      return new Response(JSON.stringify({ error: 'Sem permissão para esta empresa.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    let chargeId = chargeIdInput;
    if (!chargeId) {
      const { data: statusRow, error: statusErr } = await supabaseAnon.rpc(
        'get_company_ticket_inactivity_charge_status',
        { p_company_id: companyId },
      );
      if (statusErr) throw statusErr;
      const status = (statusRow ?? {}) as { charge_id?: string; has_pending_charge?: boolean };
      if (!status.has_pending_charge || !status.charge_id) {
        return new Response(JSON.stringify({ error: 'Não há cobrança de inatividade pendente.' }), {
          status: 404,
          headers: corsHeaders,
        });
      }
      chargeId = status.charge_id;
    }

    const { data: charge, error: chargeErr } = await supabaseService
      .from('company_ticket_inactivity_charges')
      .select('id, company_id, amount, status, reference_month')
      .eq('id', chargeId)
      .eq('company_id', companyId)
      .single();

    if (chargeErr || !charge) {
      return new Response(JSON.stringify({ error: 'Cobrança não encontrada.' }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (charge.status === 'paid') {
      return new Response(
        JSON.stringify({ error: 'Esta cobrança já foi paga.', alreadyPaid: true }),
        { status: 409, headers: corsHeaders },
      );
    }

    const amount = Number(charge.amount);
    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Valor da cobrança inválido.' }), {
        status: 400,
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

    const externalReference = `ticket_inactivity_charge:${charge.id}`;
    const notificationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mercadopago-webhook`;
    const successUrl = `${base}/manager/settings/company-profile?tab=billing&inactivity_status=success&charge_id=${charge.id}`;
    const pendingUrl = `${base}/manager/settings/company-profile?tab=billing&inactivity_status=pending&charge_id=${charge.id}`;
    const failureUrl = `${base}/manager/settings/company-profile?tab=billing&inactivity_status=failure&charge_id=${charge.id}`;

    const preferenceData = {
      items: [
        {
          title: 'Taxa de inatividade comercial — EventFest',
          unit_price: amount,
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
      console.error('[create-ticket-inactivity-checkout] MP error:', errText);
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

    await supabaseService.rpc('attach_ticket_inactivity_charge_mp_preference', {
      p_charge_id: charge.id,
      p_preference_id: String(mpJson.id),
    });

    return new Response(
      JSON.stringify({
        checkoutUrl: mpJson.init_point,
        chargeId: charge.id,
        amount,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    console.error('[create-ticket-inactivity-checkout]', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Erro interno.' }),
      { status: 500, headers: corsHeaders },
    );
  }
});
