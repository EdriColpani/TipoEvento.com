import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encryptCredential, last4 } from './mp-credential-crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const ADMIN_MASTER_USER_TYPE_ID = 1;

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

  const { data: profile } = await supabaseAnon
    .from('profiles')
    .select('tipo_usuario_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.tipo_usuario_id !== ADMIN_MASTER_USER_TYPE_ID) {
    return new Response(JSON.stringify({ error: 'Apenas Admin Master.' }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const publicKey = typeof body.publicKey === 'string' ? body.publicKey.trim() : '';
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';

    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: existing } = await supabaseService
      .from('system_billing_settings')
      .select(
        'platform_mp_public_key_ciphertext, platform_mp_access_token_ciphertext, platform_mp_public_key_last4, platform_mp_token_last4',
      )
      .eq('id', 1)
      .maybeSingle();

    let publicKeyCipher = existing?.platform_mp_public_key_ciphertext ?? null;
    let tokenCipher = existing?.platform_mp_access_token_ciphertext ?? null;
    let publicKeyLast4 = existing?.platform_mp_public_key_last4 ?? null;
    let tokenLast4 = existing?.platform_mp_token_last4 ?? null;

    if (publicKey && !publicKey.startsWith('••••')) {
      publicKeyCipher = await encryptCredential(publicKey);
      publicKeyLast4 = last4(publicKey);
    }
    if (accessToken && !accessToken.startsWith('••••')) {
      tokenCipher = await encryptCredential(accessToken);
      tokenLast4 = last4(accessToken);
    }

    if (!tokenCipher) {
      return new Response(
        JSON.stringify({
          error: 'Informe o Access Token da conta Mercado Pago da plataforma (mensalidades e recorrência).',
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    const { error: upsertErr } = await supabaseService.from('system_billing_settings').upsert(
      {
        id: 1,
        platform_mp_public_key_ciphertext: publicKeyCipher,
        platform_mp_access_token_ciphertext: tokenCipher,
        platform_mp_public_key_last4: publicKeyLast4,
        platform_mp_token_last4: tokenLast4,
        platform_mp_updated_at: new Date().toISOString(),
        platform_mp_updated_by: user.id,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: 'id' },
    );

    if (upsertErr) {
      console.error('[save-platform-mp-settings]', upsertErr);
      return new Response(JSON.stringify({ error: upsertErr.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        configured: true,
        public_key_last4: publicKeyLast4,
        token_last4: tokenLast4,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    console.error('[save-platform-mp-settings]', e);
    const msg = e instanceof Error ? e.message : 'Erro interno.';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
