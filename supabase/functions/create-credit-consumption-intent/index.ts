import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyCreditMenuToken } from '../_shared/credit-menu-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

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
    const menuToken = typeof body.menuToken === 'string' ? body.menuToken.trim() : '';
    const items = Array.isArray(body.items) ? body.items : [];

    if (!menuToken) {
      return new Response(JSON.stringify({ error: 'QR do balcão inválido.' }), { status: 400, headers: corsHeaders });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Adicione ao menos um item.' }), { status: 400, headers: corsHeaders });
    }

    const verified = await verifyCreditMenuToken(menuToken);
    if (!verified.ok) {
      return new Response(JSON.stringify({ error: verified.message, errorCode: verified.error_code }), {
        status: verified.error_code === 'menu_qr_expired' ? 409 : 400,
        headers: corsHeaders,
      });
    }

    const normalizedItems = items
      .map((item) => ({
        productId: typeof (item as Record<string, unknown>).productId === 'string'
          ? (item as Record<string, unknown>).productId
          : '',
        quantity: Number((item as Record<string, unknown>).quantity ?? 0),
      }))
      .filter((item) => item.productId && item.quantity > 0);

    if (normalizedItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Itens inválidos.' }), { status: 400, headers: corsHeaders });
    }

    const { data, error } = await supabaseAnon.rpc('create_credit_consumption_intent', {
      p_establishment_id: verified.establishmentId,
      p_items: normalizedItems,
      p_channel: 'customer_app',
    });
    if (error) throw error;

    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (err: unknown) {
    console.error('[create-credit-consumption-intent]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
