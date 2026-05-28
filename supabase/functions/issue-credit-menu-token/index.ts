import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { signCreditMenuToken } from '../_shared/credit-menu-token.ts';

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
  if (!authHeader) {
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
    const establishmentId = typeof body.establishmentId === 'string' ? body.establishmentId.trim() : '';
    if (!establishmentId) {
      return new Response(JSON.stringify({ error: 'Informe o estabelecimento.' }), { status: 400, headers: corsHeaders });
    }

    const { data: pdvCtx, error: ctxErr } = await supabaseAnon.rpc('get_establishment_pdv_context', {
      p_establishment_id: establishmentId,
    });
    if (ctxErr) throw ctxErr;
    if (!pdvCtx?.ready) {
      return new Response(
        JSON.stringify({ error: 'Este ponto de venda não está habilitado para crédito EventFest.' }),
        { status: 403, headers: corsHeaders },
      );
    }

    const signed = await signCreditMenuToken(establishmentId, { ttlSeconds: 300 });
    return new Response(JSON.stringify(signed), { status: 200, headers: corsHeaders });
  } catch (err: unknown) {
    console.error('[issue-credit-menu-token]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
