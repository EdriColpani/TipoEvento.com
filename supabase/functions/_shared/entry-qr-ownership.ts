import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export function isPaidReceivable(r: { status?: string; payment_status?: string | null }): boolean {
  return (
    r.status === 'paid' ||
    r.payment_status === 'approved' ||
    r.payment_status === 'authorized'
  );
}

/** Dono do ingresso: client_user_id ou compra paga em receivables. */
export async function userOwnsAnalyticsEntry(
  supabase: SupabaseClient,
  userId: string,
  analyticsId: string,
  clientUserId: string | null,
): Promise<boolean> {
  if (clientUserId === userId) return true;

  const { data: receivables, error } = await supabase
    .from('receivables')
    .select('status, payment_status, wristband_analytics_ids')
    .eq('client_user_id', userId);

  if (error) {
    console.error('[entry-qr-ownership] receivables:', error);
    return false;
  }

  for (const row of receivables ?? []) {
    if (!isPaidReceivable(row as { status: string; payment_status: string | null })) continue;
    const ids = (row as { wristband_analytics_ids?: string[] | null }).wristband_analytics_ids;
    if (Array.isArray(ids) && ids.includes(analyticsId)) return true;
  }
  return false;
}
