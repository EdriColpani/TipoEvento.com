import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export async function companyListingSubscriptionBlocks(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ blocked: boolean; message: string }> {
  const { data, error } = await supabase.rpc('company_listing_subscription_blocks_operations', {
    p_company_id: companyId,
  });

  if (error) {
    console.error('[listing-subscription-guard]', error);
    return { blocked: false, message: '' };
  }

  if (data === true) {
    return {
      blocked: true,
      message:
        'Assinatura da mensalidade vencida. Renove no painel do gestor para validar ingressos ou usar chaves.',
    };
  }

  return { blocked: false, message: '' };
}

export async function eventListingSubscriptionBlocks(
  supabase: SupabaseClient,
  eventId: string | null,
): Promise<{ blocked: boolean; message: string }> {
  if (!eventId) return { blocked: false, message: '' };

  const { data: event, error } = await supabase
    .from('events')
    .select('company_id')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event?.company_id) {
    return { blocked: false, message: '' };
  }

  return companyListingSubscriptionBlocks(supabase, event.company_id as string);
}
