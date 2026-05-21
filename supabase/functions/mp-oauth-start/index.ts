import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { randomState, randomVerifier, sha256Challenge } from './mp-credential-crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const ADMIN_MASTER = 1;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

  const { data: profile } = await supabaseAnon.from('profiles').select('tipo_usuario_id').eq('id', user.id).maybeSingle();
  if (profile?.tipo_usuario_id === ADMIN_MASTER) {
    return new Response(JSON.stringify({ error: 'Admin Master não conecta conta de gestor aqui.' }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  const clientId = (Deno.env.get('MP_OAUTH_CLIENT_ID') ?? '').trim();
  const redirectUri = (Deno.env.get('MP_OAUTH_REDIRECT_URI') ?? '').trim();
  if (!clientId || !redirectUri) {
    return new Response(
      JSON.stringify({
        error: 'OAuth MP não configurado no servidor (MP_OAUTH_CLIENT_ID / MP_OAUTH_REDIRECT_URI).',
      }),
      { status: 500, headers: corsHeaders },
    );
  }

  const state = randomState();
  const codeVerifier = randomVerifier();
  const codeChallenge = await sha256Challenge(codeVerifier);

  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  await supabaseService.from('mp_oauth_states').delete().eq('user_id', user.id);
  const { error: insertErr } = await supabaseService.from('mp_oauth_states').insert({
    state,
    user_id: user.id,
    code_verifier: codeVerifier,
  });
  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: corsHeaders });
  }

  const authUrl = new URL('https://auth.mercadopago.com/authorization');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('platform_id', 'mp');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return new Response(JSON.stringify({ authorizationUrl: authUrl.toString(), state }), {
    status: 200,
    headers: corsHeaders,
  });
});
