import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encryptCredential, last4 } from './mp-credential-crypto.ts';

function redirectToApp(params: Record<string, string>): Response {
  const base = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  const path = '/manager/settings/company-profile';
  const url = new URL(`${base}${path}`);
  url.searchParams.set('tab', 'payments');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString() },
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return redirectToApp({ mp_oauth: 'error', mp_message: oauthError });
  }
  if (!code || !state) {
    return redirectToApp({ mp_oauth: 'error', mp_message: 'missing_code_or_state' });
  }

  const clientId = (Deno.env.get('MP_OAUTH_CLIENT_ID') ?? '').trim();
  const clientSecret = (Deno.env.get('MP_OAUTH_CLIENT_SECRET') ?? '').trim();
  const redirectUri = (Deno.env.get('MP_OAUTH_REDIRECT_URI') ?? '').trim();
  if (!clientId || !clientSecret || !redirectUri) {
    return redirectToApp({ mp_oauth: 'error', mp_message: 'server_oauth_not_configured' });
  }

  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: pending, error: pendingErr } = await supabaseService
    .from('mp_oauth_states')
    .select('user_id, code_verifier, expires_at')
    .eq('state', state)
    .maybeSingle();

  if (pendingErr || !pending) {
    return redirectToApp({ mp_oauth: 'error', mp_message: 'invalid_state' });
  }

  if (new Date(pending.expires_at as string).getTime() < Date.now()) {
    await supabaseService.from('mp_oauth_states').delete().eq('state', state);
    return redirectToApp({ mp_oauth: 'error', mp_message: 'state_expired' });
  }

  const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: pending.code_verifier,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[mp-oauth-callback] token error:', errText);
    return redirectToApp({ mp_oauth: 'error', mp_message: 'token_exchange_failed' });
  }

  const tokenJson = await tokenRes.json();
  const accessToken = String(tokenJson.access_token ?? '').trim();
  const refreshToken = String(tokenJson.refresh_token ?? '').trim();
  const expiresIn = Number(tokenJson.expires_in ?? 0);
  const publicKey = tokenJson.public_key ? String(tokenJson.public_key) : null;

  if (!accessToken) {
    return redirectToApp({ mp_oauth: 'error', mp_message: 'empty_access_token' });
  }

  let collectorId: string | null = tokenJson.user_id ? String(tokenJson.user_id) : null;
  if (!collectorId) {
    const meRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      collectorId = me.id != null ? String(me.id) : null;
    }
  }

  const userId = pending.user_id as string;
  const expiresAt = expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const { error: upsertErr } = await supabaseService.from('payment_settings').upsert(
    {
      user_id: userId,
      gateway_name: 'Mercado Pago',
      api_token_ciphertext: await encryptCredential(accessToken),
      api_token_last4: last4(accessToken),
      mp_refresh_token_ciphertext: refreshToken ? await encryptCredential(refreshToken) : null,
      mp_public_key: publicKey,
      mp_collector_id: collectorId,
      mp_connection_source: 'oauth',
      mp_oauth_connected_at: new Date().toISOString(),
      mp_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  await supabaseService.from('mp_oauth_states').delete().eq('state', state);

  if (upsertErr) {
    console.error('[mp-oauth-callback] upsert:', upsertErr);
    return redirectToApp({ mp_oauth: 'error', mp_message: 'save_failed' });
  }

  return redirectToApp({ mp_oauth: 'success', mp_collector: collectorId ?? '' });
});
