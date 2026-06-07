import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

type ReceivableRow = {
  id: string;
  status: string;
  payment_status: string | null;
  client_user_id: string | null;
  wristband_analytics_ids: string[] | null;
  counter_reservation_items: unknown;
  paid_at: string | null;
};

function expectedTicketCount(receivable: {
  wristband_analytics_ids: string[] | null;
  counter_reservation_items: unknown;
}): number {
  const ids = Array.isArray(receivable.wristband_analytics_ids)
    ? receivable.wristband_analytics_ids
    : [];
  if (ids.length > 0) return ids.length;

  const items = receivable.counter_reservation_items;
  if (!Array.isArray(items)) return 0;

  return items.reduce((sum, item) => {
    const qty = Number((item as { quantity?: unknown })?.quantity ?? 0);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}

async function loadReceivable(
  supabaseService: SupabaseClient,
  receivableId: string,
): Promise<ReceivableRow | null> {
  const { data, error } = await supabaseService
    .from('receivables')
    .select(
      'id, status, payment_status, client_user_id, wristband_analytics_ids, counter_reservation_items, paid_at',
    )
    .eq('id', receivableId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ReceivableRow;
}

async function materializeCounterTicketsIfNeeded(
  supabaseService: SupabaseClient,
  receivable: ReceivableRow,
): Promise<{ ok: boolean; error?: string }> {
  const existingIds = Array.isArray(receivable.wristband_analytics_ids)
    ? receivable.wristband_analytics_ids
    : [];
  if (existingIds.length > 0) {
    return { ok: true };
  }

  const items = receivable.counter_reservation_items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: true };
  }

  if (!receivable.client_user_id) {
    return { ok: false, error: 'Cliente não informado na transação.' };
  }

  const { data, error } = await supabaseService.rpc('materialize_counter_checkout_tickets', {
    p_transaction_id: receivable.id,
    p_client_user_id: receivable.client_user_id,
  });

  if (error) {
    console.error('[emit-receivable-tickets] materialize failed:', error.message);
    return { ok: false, error: error.message };
  }

  const payload = data as { ok?: boolean; skipped?: boolean; error?: string } | null;
  if (payload?.ok === true || payload?.skipped === true) {
    return { ok: true };
  }

  return {
    ok: false,
    error: payload?.error ?? 'Falha ao gerar ingressos do estoque.',
  };
}

/** Materializa (counter) e vincula ingressos ao cliente após pagamento aprovado. */
export async function emitReceivableTicketsForPaidPurchase(
  supabaseService: SupabaseClient,
  receivableId: string,
): Promise<{ updated: number; expected: number; materialized?: number }> {
  let receivable = await loadReceivable(supabaseService, receivableId);
  if (!receivable) {
    return { updated: 0, expected: 0 };
  }

  const paymentOk =
    receivable.status === 'paid' ||
    receivable.payment_status === 'approved' ||
    receivable.payment_status === 'authorized';

  if (!paymentOk || !receivable.client_user_id) {
    return { updated: 0, expected: 0 };
  }

  const materializeResult = await materializeCounterTicketsIfNeeded(supabaseService, receivable);
  if (!materializeResult.ok) {
    return { updated: 0, expected: expectedTicketCount(receivable) };
  }

  receivable = (await loadReceivable(supabaseService, receivableId)) ?? receivable;

  const ids = Array.isArray(receivable.wristband_analytics_ids)
    ? receivable.wristband_analytics_ids
    : [];
  const expected = ids.length > 0 ? ids.length : expectedTicketCount(receivable);
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

  const { count } = await supabaseService
    .from('wristband_analytics')
    .select('id', { count: 'exact', head: true })
    .in('id', ids)
    .eq('client_user_id', receivable.client_user_id)
    .eq('event_type', 'purchase')
    .in('status', ['active', 'used']);

  const assigned = count ?? 0;

  return {
    updated: Math.max(updated, assigned),
    expected,
  };
}

export async function countAssignedTickets(
  supabaseService: SupabaseClient,
  receivableId: string,
  clientUserId: string,
): Promise<{ assigned: number; expected: number }> {
  const receivable = await loadReceivable(supabaseService, receivableId);
  if (!receivable) {
    return { assigned: 0, expected: 0 };
  }

  const ids = Array.isArray(receivable.wristband_analytics_ids)
    ? receivable.wristband_analytics_ids
    : [];
  const expected = ids.length > 0 ? ids.length : expectedTicketCount(receivable);
  if (expected === 0) {
    return { assigned: 0, expected: 0 };
  }

  if (ids.length === 0) {
    return { assigned: 0, expected };
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
