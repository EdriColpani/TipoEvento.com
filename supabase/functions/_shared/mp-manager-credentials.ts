import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decryptCredential, encryptCredential } from './mp-credential-crypto.ts';

export type ManagerMpCredentials = {
  managerUserId: string;
  accessToken: string;
  collectorId: string;
};

async function refreshManagerTokenIfNeeded(
  supabaseService: SupabaseClient,
  userId: string,
  row: {
    mp_refresh_token_ciphertext: string | null;
    mp_token_expires_at: string | null;
    api_token_ciphertext: string | null;
  },
): Promise<string | null> {
  const cipher = row.api_token_ciphertext;
  if (!cipher) return null;

  const expiresAt = row.mp_token_expires_at ? new Date(row.mp_token_expires_at).getTime() : null;
  const needsRefresh = expiresAt != null && expiresAt < Date.now() + 60_000;
  if (!needsRefresh) {
    return (await decryptCredential(cipher)).trim();
  }

  const refreshCipher = row.mp_refresh_token_ciphertext;
  if (!refreshCipher) {
    return (await decryptCredential(cipher)).trim();
  }

  const clientId = (Deno.env.get('MP_OAUTH_CLIENT_ID') ?? '').trim();
  const clientSecret = (Deno.env.get('MP_OAUTH_CLIENT_SECRET') ?? '').trim();
  if (!clientId || !clientSecret) {
    return (await decryptCredential(cipher)).trim();
  }

  const refreshToken = await decryptCredential(refreshCipher);
  const res = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    console.warn('[mp-manager-credentials] refresh failed:', await res.text());
    return (await decryptCredential(cipher)).trim();
  }

  const json = await res.json();
  const accessToken = String(json.access_token ?? '').trim();
  if (!accessToken) return null;

  const expiresIn = Number(json.expires_in ?? 0);
  const newRefresh = json.refresh_token ? String(json.refresh_token) : refreshToken;

  await supabaseService.from('payment_settings').update({
    api_token_ciphertext: await encryptCredential(accessToken),
    api_token_last4: accessToken.slice(-4),
    mp_refresh_token_ciphertext: await encryptCredential(newRefresh),
    mp_token_expires_at: expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  return accessToken;
}

export async function getManagerMpAccessToken(
  supabaseService: SupabaseClient,
  managerUserId: string,
): Promise<{ accessToken: string; collectorId: string | null } | null> {
  const { data, error } = await supabaseService
    .from('payment_settings')
    .select(
      'api_token_ciphertext, mp_refresh_token_ciphertext, mp_token_expires_at, mp_collector_id',
    )
    .eq('user_id', managerUserId)
    .maybeSingle();

  if (error || !data?.api_token_ciphertext) return null;

  const token = await refreshManagerTokenIfNeeded(supabaseService, managerUserId, data);
  if (!token) return null;

  return {
    accessToken: token,
    collectorId: data.mp_collector_id ? String(data.mp_collector_id) : null,
  };
}

export async function resolveReceiverCompanyMpCredentials(
  supabaseService: SupabaseClient,
  companyId: string,
): Promise<ManagerMpCredentials | null> {
  const { data, error } = await supabaseService.rpc('get_receiver_company_mp_credentials', {
    p_company_id: companyId,
  });

  if (error) {
    console.error('[mp-manager-credentials] RPC error:', error.message);
    return null;
  }

  const payload = data as {
    ok?: boolean;
    manager_user_id?: string;
    mp_collector_id?: string;
  };

  if (!payload?.ok || !payload.manager_user_id || !payload.mp_collector_id) {
    return null;
  }

  const mp = await getManagerMpAccessToken(supabaseService, payload.manager_user_id);
  if (!mp?.accessToken) return null;

  return {
    managerUserId: payload.manager_user_id,
    accessToken: mp.accessToken,
    collectorId: payload.mp_collector_id,
  };
}
