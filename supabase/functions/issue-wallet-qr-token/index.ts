import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { signWalletQrToken } from '../_shared/wallet-qr-token.ts';

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
    const { data: moduleStatus } = await supabaseAnon.rpc('get_credit_wallet_status');
    if (moduleStatus?.module_enabled === false) {
      return new Response(JSON.stringify({ error: 'Módulo de créditos indisponível.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { data: balanceData, error: balErr } = await supabaseAnon.rpc('get_client_credit_balance');
    if (balErr) throw balErr;
    if (balanceData?.status && balanceData.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Sua carteira não está ativa.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const issued = await signWalletQrToken(user.id);
    return new Response(JSON.stringify(issued), { status: 200, headers: corsHeaders });
  } catch (err: unknown) {
    console.error('[issue-wallet-qr-token]', err);
    const message = err instanceof Error ? err.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
