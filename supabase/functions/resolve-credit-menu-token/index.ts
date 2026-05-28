import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyCreditMenuToken } from '../_shared/credit-menu-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const menuToken = typeof body.menuToken === 'string' ? body.menuToken.trim() : '';
    if (!menuToken) {
      return new Response(JSON.stringify({ error: 'Informe o token do cardápio.' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const verified = await verifyCreditMenuToken(menuToken);
    if (!verified.ok) {
      return new Response(JSON.stringify({ error: verified.message, errorCode: verified.error_code }), {
        status: verified.error_code === 'menu_qr_expired' ? 409 : 400,
        headers: corsHeaders,
      });
    }

    const establishmentId = verified.establishmentId;
    const { data: est, error: estErr } = await supabaseService
      .from('credit_establishments')
      .select('id, company_id, event_id, name, active, credit_acceptance_enabled')
      .eq('id', establishmentId)
      .maybeSingle();
    if (estErr) throw estErr;
    if (!est) {
      return new Response(JSON.stringify({ error: 'Estabelecimento não encontrado.' }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const { data: settings, error: settingsErr } = await supabaseService
      .from('system_billing_settings')
      .select('consumption_module_enabled, hybrid_consumption_module_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (settingsErr) throw settingsErr;
    const moduleEnabled = Boolean(settings?.consumption_module_enabled || settings?.hybrid_consumption_module_enabled);

    const { data: company, error: companyErr } = await supabaseService
      .from('companies')
      .select('id, billing_plan, corporate_name')
      .eq('id', est.company_id)
      .maybeSingle();
    if (companyErr) throw companyErr;

    const billingPlan = String(company?.billing_plan ?? '');
    const companyAllowsCredit =
      billingPlan === 'ticket_plus_consumption'
      || billingPlan === 'consumption_or_license'
      || (billingPlan === 'ticket_commission' && moduleEnabled);

    if (!moduleEnabled || !companyAllowsCredit || !est.active || !est.credit_acceptance_enabled) {
      return new Response(
        JSON.stringify({ error: 'Este balcão não está habilitado para consumo com crédito no momento.' }),
        { status: 403, headers: corsHeaders },
      );
    }

    const { data: event } = await supabaseService
      .from('events')
      .select('id, title')
      .eq('id', est.event_id)
      .maybeSingle();

    const { data: products, error: productsErr } = await supabaseService
      .from('credit_establishment_products')
      .select('id, name, description, unit_price, active')
      .eq('establishment_id', est.id)
      .eq('active', true)
      .order('name', { ascending: true });
    if (productsErr) throw productsErr;

    return new Response(
      JSON.stringify({
        ok: true,
        establishment: {
          id: est.id,
          name: est.name,
          companyName: company?.corporate_name ?? 'Empresa parceira',
          eventTitle: event?.title ?? null,
        },
        products: (products ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          unitPrice: Number(p.unit_price ?? 0),
        })),
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err: unknown) {
    console.error('[resolve-credit-menu-token]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
