import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decryptCredential } from './mp-credential-crypto.ts';

/** Token MP da plataforma EventFest — mensalidade, recorrência, cobranças B2B. */
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
    throw new Error(
      'Pagamento da plataforma não configurado (PLATFORM_MP_ACCESS_TOKEN ou credencial em Configurações Avançadas).',
    );
  }

  return (await decryptCredential(cipher.trim())).trim();
}
