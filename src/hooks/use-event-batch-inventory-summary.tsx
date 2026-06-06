import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type EventBatchInventoryRow = {
    batch_id: string;
    name: string;
    quantity: number;
    price: number;
    total: number;
    sold: number;
    reserved: number;
    available: number;
    start_date: string | null;
    end_date: string | null;
};

export type EventBatchInventorySummary = {
    event_id: string;
    event_title: string;
    inventory_mode: string;
    capacity: number;
    batch_total: number;
    batches: EventBatchInventoryRow[];
};

async function fetchSummary(eventId: string): Promise<EventBatchInventorySummary | null> {
    const { data: event, error: eventError } = await supabase
        .from('events')
        .select('id, title, capacity, inventory_mode')
        .eq('id', eventId)
        .maybeSingle();

    if (eventError) throw eventError;
    if (!event) return null;

    const { data: batches, error: batchError } = await supabase
        .from('event_batches')
        .select('id, name, quantity, price, start_date, end_date')
        .eq('event_id', eventId)
        .order('name');

    if (batchError) throw batchError;

    const { data: inventory, error: invError } = await supabase
        .from('batch_inventory')
        .select('batch_id, total, sold, reserved')
        .eq('event_id', eventId);

    if (invError) throw invError;

    const invByBatch = Object.fromEntries(
        (inventory ?? []).map((row) => [row.batch_id, row]),
    );

    const rows: EventBatchInventoryRow[] = (batches ?? []).map((b) => {
        const inv = invByBatch[b.id];
        const total = inv?.total ?? b.quantity ?? 0;
        const sold = inv?.sold ?? 0;
        const reserved = inv?.reserved ?? 0;
        return {
            batch_id: b.id,
            name: b.name,
            quantity: b.quantity ?? 0,
            price: Number(b.price ?? 0),
            total,
            sold,
            reserved,
            available: Math.max(total - sold - reserved, 0),
            start_date: b.start_date,
            end_date: b.end_date,
        };
    });

    const batchTotal = rows.reduce((sum, r) => sum + r.total, 0);

    return {
        event_id: event.id,
        event_title: event.title,
        inventory_mode: event.inventory_mode ?? 'unit_rows',
        capacity: Number(event.capacity ?? 0),
        batch_total: batchTotal,
        batches: rows,
    };
}

export function useEventBatchInventorySummary(eventId: string | undefined, enabled = true) {
    return useQuery({
        queryKey: ['eventBatchInventorySummary', eventId],
        enabled: Boolean(eventId) && enabled,
        staleTime: 30_000,
        queryFn: () => fetchSummary(eventId!),
    });
}
