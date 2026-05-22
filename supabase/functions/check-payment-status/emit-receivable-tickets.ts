import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/** Vincula ingressos reservados ao cliente (mesma regra da RPC client_emit_receivable_tickets). */
export async function emitReceivableTicketsForPaidPurchase(
  supabaseService: SupabaseClient,
  receivableId: string,
): Promise<{ updated: number; expected: number }> {
  const { data: receivable, error } = await supabaseService
    .from('receivables')
    .select('id, status, payment_status, client_user_id, wristband_analytics_ids, paid_at')
    .eq('id', receivableId)
    .maybeSingle();

  if (error || !receivable) {
    return { updated: 0, expected: 0 };
  }

  const paymentOk =
    receivable.status === 'paid' ||
    receivable.payment_status === 'approved' ||
    receivable.payment_status === 'authorized';

  if (!paymentOk || !receivable.client_user_id) {
    return { updated: 0, expected: 0 };
  }

  const ids = Array.isArray(receivable.wristband_analytics_ids)
    ? receivable.wristband_analytics_ids
    : [];
  const expected = ids.length;
  if (expected === 0) {
    return { updated: 0, expected: 0 };
  }

  const { data: updatedRows, error: updateError } = await supabaseService
    .from('wristband_analytics')
    .update({
      client_user_id: receivable.client_user_id,
      status: 'active',
      event_type: 'purchase',
    })
    .in('id', ids)
    .in('status', ['pending', 'active'])
    .select('id');

  if (updateError) {
    console.error('[emit-receivable-tickets] update failed:', updateError);
    return { updated: 0, expected };
  }

  const updated = updatedRows?.length ?? 0;

  if (updated > 0) {
    const paidAt = receivable.paid_at ?? new Date().toISOString();
    for (const row of updatedRows ?? []) {
      const analyticsId = row.id as string;
      const { data: wa } = await supabaseService
        .from('wristband_analytics')
        .select('event_data')
        .eq('id', analyticsId)
        .maybeSingle();
      const merged = {
        ...(typeof wa?.event_data === 'object' && wa?.event_data !== null ? wa.event_data : {}),
        purchase_date: paidAt,
        client_id: receivable.client_user_id,
        transaction_id: receivableId,
      };
      await supabaseService
        .from('wristband_analytics')
        .update({ event_data: merged })
        .eq('id', analyticsId);
    }
  }

  return { updated, expected };
}

export async function countAssignedTickets(
  supabaseService: SupabaseClient,
  receivableId: string,
  clientUserId: string,
): Promise<{ assigned: number; expected: number }> {
  const { data: receivable } = await supabaseService
    .from('receivables')
    .select('wristband_analytics_ids')
    .eq('id', receivableId)
    .maybeSingle();

  const ids = Array.isArray(receivable?.wristband_analytics_ids)
    ? receivable.wristband_analytics_ids
    : [];
  const expected = ids.length;
  if (expected === 0) {
    return { assigned: 0, expected: 0 };
  }

  const { count } = await supabaseService
    .from('wristband_analytics')
    .select('id', { count: 'exact', head: true })
    .in('id', ids)
    .eq('client_user_id', clientUserId)
    .eq('event_type', 'purchase')
    .in('status', ['active', 'used']);

  return { assigned: count ?? 0, expected };
}
