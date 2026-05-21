import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decryptCredential } from './mp-credential-crypto.ts';

export async function getManagerMpAccessToken(
  supabaseService: SupabaseClient,
  managerUserId: string,
): Promise<string | null> {
  const { data, error } = await supabaseService
    .from('payment_settings')
    .select('api_token_ciphertext')
    .eq('user_id', managerUserId)
    .maybeSingle();

  if (error || !data?.api_token_ciphertext) return null;
  return (await decryptCredential(String(data.api_token_ciphertext))).trim();
}

export function getLegacyTicketMpAccessToken(): string | null {
  const token = (Deno.env.get('PAYMENT_API_KEY_SECRET') ?? '').trim();
  return token || null;
}

export async function getPlatformMpAccessToken(
  supabaseService: SupabaseClient,
): Promise<string> {
  const envToken = (Deno.env.get('PLATFORM_MP_ACCESS_TOKEN') ?? '').trim();
  if (envToken) return envToken;

  const { data, error } = await supabaseService
    .from('system_billing_settings')
    .select('platform_mp_access_token_ciphertext')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new Error(`Erro ao ler credencial da plataforma: ${error.message}`);

  const cipher = data?.platform_mp_access_token_ciphertext as string | null;
  if (!cipher?.trim()) {
    throw new Error('Credencial da plataforma não configurada.');
  }

  return (await decryptCredential(cipher.trim())).trim();
}

export async function fetchMpPaymentById(
  paymentId: string,
  accessToken: string,
): Promise<Response> {
  return fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Resolve pagamento MP no webhook: mensalidade (plataforma) ou ingresso (gestor/legado).
 */
export async function resolveWebhookPayment(
  supabaseService: SupabaseClient,
  paymentId: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; text: string }> {
  const tryTokens: string[] = [];

  try {
    tryTokens.push(await getPlatformMpAccessToken(supabaseService));
  } catch {
    /* plataforma opcional para ingressos */
  }

  const legacy = getLegacyTicketMpAccessToken();
  if (legacy) tryTokens.push(legacy);

  const seen = new Set<string>();
  for (const token of tryTokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    const res = await fetchMpPaymentById(paymentId, token);
    if (res.ok) {
      return { ok: true, data: await res.json() };
    }
  }

  const { data: pendingRows } = await supabaseService
    .from('receivables')
    .select('manager_user_id')
    .eq('status', 'pending')
    .not('mp_preference_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);

  const managerIds = [
    ...new Set(
      (pendingRows ?? [])
        .map((r) => r.manager_user_id as string)
        .filter(Boolean),
    ),
  ];

  for (const managerUserId of managerIds) {
    const managerToken = await getManagerMpAccessToken(supabaseService, managerUserId);
    if (!managerToken || seen.has(managerToken)) continue;
    seen.add(managerToken);
    const res = await fetchMpPaymentById(paymentId, managerToken);
    if (res.ok) {
      return { ok: true, data: await res.json() };
    }
  }

  const lastRes = await fetchMpPaymentById(paymentId, tryTokens[0] ?? legacy ?? '');
  return {
    ok: false,
    status: lastRes.status,
    text: await lastRes.text(),
  };
}
