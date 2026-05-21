import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decryptCredential, encryptCredential } from './mp-credential-crypto.ts';

export type TicketCheckoutTokenSource = 'manager' | 'legacy_env';

export type TicketCheckoutTokenResult = {
  accessToken: string;
  source: TicketCheckoutTokenSource;
  collectorId?: string | null;
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
    console.warn('[mp-ticket-payment] refresh token failed:', await res.text());
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
      'api_token_ciphertext, mp_refresh_token_ciphertext, mp_token_expires_at, mp_collector_id, mp_connection_source',
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

function getLegacyTicketMpAccessToken(): string | null {
  const token = (Deno.env.get('PAYMENT_API_KEY_SECRET') ?? '').trim();
  return token || null;
}

export async function resolveTicketCheckoutToken(
  supabaseService: SupabaseClient,
  managerUserId: string,
): Promise<TicketCheckoutTokenResult> {
  const allowLegacy = (Deno.env.get('TICKET_MP_ALLOW_LEGACY_SECRET') ?? 'true').trim() !== 'false';
  const requireOAuth = (Deno.env.get('TICKET_MP_REQUIRE_MANAGER_CREDENTIAL') ?? 'false').trim() === 'true';

  const manager = await getManagerMpAccessToken(supabaseService, managerUserId);
  if (manager) {
    return {
      accessToken: manager.accessToken,
      source: 'manager',
      collectorId: manager.collectorId,
    };
  }

  if (requireOAuth) {
    throw new Error(
      'Conecte sua conta Mercado Pago em Perfil da Empresa → Ingressos MP (botão Conectar com Mercado Pago).',
    );
  }

  if (allowLegacy) {
    const legacy = getLegacyTicketMpAccessToken();
    if (legacy) {
      return { accessToken: legacy, source: 'legacy_env', collectorId: null };
    }
  }

  throw new Error(
    'Conta Mercado Pago não configurada. Use Conectar com Mercado Pago ou cadastre o token em Perfil da Empresa → Ingressos MP.',
  );
}

export function calcMarketplaceFee(grossTotal: number, appliedPercentage: number): number {
  if (!Number.isFinite(grossTotal) || grossTotal <= 0) return 0;
  if (!Number.isFinite(appliedPercentage) || appliedPercentage <= 0) return 0;
  const fee = grossTotal * (appliedPercentage / 100);
  return Math.round(fee * 100) / 100;
}
