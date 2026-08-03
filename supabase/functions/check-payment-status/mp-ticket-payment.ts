import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decryptCredential } from './mp-credential-crypto.ts';

async function getPlatformMpAccessToken(supabaseService: SupabaseClient): Promise<string> {
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
    throw new Error(
      'Pagamento da plataforma não configurado. Admin: configure Mercado Pago da EventFest.',
    );
  }

  return (await decryptCredential(cipher.trim())).trim();
}

/**
 * Token correto para consultar o pagamento no MP.
 * - collector plataforma (banco D+1): token EventFest
 * - split gestor: token do gestor
 * Fallback: tenta os dois (pagamento no app nativo pode atrasar o webhook).
 */
export async function resolveTicketPaymentQueryTokens(
  supabaseService: SupabaseClient,
  managerUserId: string,
  options?: { collectorType?: string | null; settlementChannel?: string | null },
): Promise<string[]> {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (t: string | null | undefined) => {
    const v = (t ?? '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    tokens.push(v);
  };

  const prefersPlatform =
    options?.collectorType === 'platform' || options?.settlementChannel === 'manual_d1';

  let platformToken: string | null = null;
  try {
    platformToken = await getPlatformMpAccessToken(supabaseService);
  } catch {
    platformToken = null;
  }

  let managerToken: string | null = null;
  const { data } = await supabaseService
    .from('payment_settings')
    .select('api_token_ciphertext')
    .eq('user_id', managerUserId)
    .maybeSingle();
  if (data?.api_token_ciphertext) {
    try {
      managerToken = (await decryptCredential(String(data.api_token_ciphertext))).trim();
    } catch {
      managerToken = null;
    }
  }

  const legacy = (Deno.env.get('PAYMENT_API_KEY_SECRET') ?? '').trim();

  if (prefersPlatform) {
    push(platformToken);
    push(managerToken);
    push(legacy);
  } else {
    push(managerToken);
    push(platformToken);
    push(legacy);
  }

  if (tokens.length === 0) {
    throw new Error('Credencial MP indisponível para consultar o pagamento.');
  }

  return tokens;
}

/** @deprecated use resolveTicketPaymentQueryTokens */
export async function resolveTicketPaymentQueryToken(
  supabaseService: SupabaseClient,
  managerUserId: string,
): Promise<string> {
  const tokens = await resolveTicketPaymentQueryTokens(supabaseService, managerUserId);
  return tokens[0];
}
