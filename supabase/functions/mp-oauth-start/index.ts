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

  // Application ID numérico — não confundir com Public Key (APP_USR-…) nem Access Token
  if (!/^\d{6,20}$/.test(clientId)) {
    return new Response(
      JSON.stringify({
        error:
          'MP_OAUTH_CLIENT_ID inválido: use o Número da aplicação (Application ID) em Developers → Detalhes da aplicação, não a Public Key nem o Access Token.',
      }),
      { status: 400, headers: corsHeaders },
    );
  }

  let redirectParsed: URL;
  try {
    redirectParsed = new URL(redirectUri);
  } catch {
    return new Response(
      JSON.stringify({ error: 'MP_OAUTH_REDIRECT_URI deve ser uma URL absoluta https válida.' }),
      { status: 400, headers: corsHeaders },
    );
  }
  if (redirectParsed.protocol !== 'https:') {
    return new Response(
      JSON.stringify({ error: 'MP_OAUTH_REDIRECT_URI deve usar HTTPS (ex.: callback do Supabase).' }),
      { status: 400, headers: corsHeaders },
    );
  }
  const expectedCallback = '/functions/v1/mp-oauth-callback';
  const pathNorm = redirectParsed.pathname.replace(/\/+$/, '');
  if (pathNorm !== expectedCallback) {
    return new Response(
      JSON.stringify({
        error: `MP_OAUTH_REDIRECT_URI deve ser: https://SEU_PROJECT.supabase.co${expectedCallback}`,
        hint: 'Cadastre a mesma URL em Mercado Pago → Developers → Redirect URLs.',
      }),
      { status: 400, headers: corsHeaders },
    );
  }

  const usePkce = (Deno.env.get('MP_OAUTH_USE_PKCE') ?? 'true').trim().toLowerCase() !== 'false';

  const state = randomState();
  let codeVerifier: string | null = null;
  let codeChallenge: string | null = null;
  if (usePkce) {
    codeVerifier = randomVerifier();
    codeChallenge = await sha256Challenge(codeVerifier);
  }

  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  await supabaseService.from('mp_oauth_states').delete().eq('user_id', user.id);
  const { error: insertErr } = await supabaseService.from('mp_oauth_states').insert({
    state,
    user_id: user.id,
    code_verifier: codeVerifier ?? '',
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
  if (usePkce && codeChallenge) {
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
  }

  return new Response(JSON.stringify({ authorizationUrl: authUrl.toString(), state, pkce: usePkce }), {
    status: 200,
    headers: corsHeaders,
  });
});
