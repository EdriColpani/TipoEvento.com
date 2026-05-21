import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encryptCredential, last4 } from './mp-credential-crypto.ts';

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

  const ADMIN_MASTER_USER_TYPE_ID = 1;
  const { data: profile } = await supabaseAnon
    .from('profiles')
    .select('tipo_usuario_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID) {
    return new Response(
      JSON.stringify({
        error: 'Admin Master usa Configurações Avançadas para credenciais da plataforma (mensalidade), não credenciais de ingresso do gestor.',
      }),
      { status: 403, headers: corsHeaders },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const gatewayName = typeof body.gatewayName === 'string' && body.gatewayName.trim()
      ? body.gatewayName.trim()
      : 'Mercado Pago';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : '';
    const companyId = typeof body.companyId === 'string' ? body.companyId : null;

    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: existing } = await supabaseService
      .from('payment_settings')
      .select('api_key_ciphertext, api_token_ciphertext, api_key_last4, api_token_last4')
      .eq('user_id', user.id)
      .maybeSingle();

    let apiKeyCipher = existing?.api_key_ciphertext ?? null;
    let apiTokenCipher = existing?.api_token_ciphertext ?? null;
    let apiKeyLast4 = existing?.api_key_last4 ?? null;
    let apiTokenLast4 = existing?.api_token_last4 ?? null;

    if (apiKey && !apiKey.startsWith('••••')) {
      apiKeyCipher = await encryptCredential(apiKey);
      apiKeyLast4 = last4(apiKey);
    }
    if (apiToken && !apiToken.startsWith('••••')) {
      apiTokenCipher = await encryptCredential(apiToken);
      apiTokenLast4 = last4(apiToken);
    }

    if (!apiTokenCipher) {
      return new Response(
        JSON.stringify({ error: 'Informe o Access Token do Mercado Pago (conta do gestor para ingressos).' }),
        { status: 400, headers: corsHeaders },
      );
    }

    const { error: upsertErr } = await supabaseService.from('payment_settings').upsert(
      {
        user_id: user.id,
        company_id: companyId,
        gateway_name: gatewayName,
        api_key_ciphertext: apiKeyCipher,
        api_token_ciphertext: apiTokenCipher,
        api_key_last4: apiKeyLast4,
        api_token_last4: apiTokenLast4,
        mp_connection_source: 'manual',
        mp_oauth_connected_at: null,
        mp_refresh_token_ciphertext: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    if (upsertErr) {
      console.error('[save-manager-payment-settings]', upsertErr);
      return new Response(JSON.stringify({ error: upsertErr.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        configured: true,
        gateway_name: gatewayName,
        api_key_last4: apiKeyLast4,
        api_token_last4: apiTokenLast4,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    console.error('[save-manager-payment-settings]', e);
    const msg = e instanceof Error ? e.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
