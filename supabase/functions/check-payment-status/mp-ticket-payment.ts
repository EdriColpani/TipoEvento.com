import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decryptCredential } from './mp-credential-crypto.ts';

export async function resolveTicketPaymentQueryToken(
  supabaseService: SupabaseClient,
  managerUserId: string,
): Promise<string> {
  const { data } = await supabaseService
    .from('payment_settings')
    .select('api_token_ciphertext')
    .eq('user_id', managerUserId)
    .maybeSingle();

  if (data?.api_token_ciphertext) {
    return (await decryptCredential(String(data.api_token_ciphertext))).trim();
  }

  const legacy = (Deno.env.get('PAYMENT_API_KEY_SECRET') ?? '').trim();
  if (legacy) return legacy;

  throw new Error('Credencial MP do gestor não configurada.');
}
