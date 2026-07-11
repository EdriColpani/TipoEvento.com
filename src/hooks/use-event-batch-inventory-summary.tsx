import { useQuery } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';

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

type EventRow = {
    id: string;
    title?: string;
    capacity?: number | null;
    inventory_mode?: string | null;
};

type BatchRow = {
    id: string;
    name?: string | null;
    quantity?: number | null;
    price?: number | null;
    start_date?: string | null;
    end_date?: string | null;
};

type InvRow = {
    batch_id: string;
    total?: number | null;
    sold?: number | null;
    reserved?: number | null;
};

async function fetchSummary(eventId: string): Promise<EventBatchInventorySummary | null> {
    const events = await restGet<EventRow[]>(
        `events?id=eq.${encodeURIComponent(eventId)}&select=id,title,capacity,inventory_mode&limit=1`,
        12_000,
    );
    const event = events?.[0];
    if (!event) return null;

    const batches = await restGet<BatchRow[]>(
        `event_batches?event_id=eq.${encodeURIComponent(eventId)}&select=id,name,quantity,price,start_date,end_date&order=name.asc&limit=500`,
        12_000,
    );

    const batchList = batches ?? [];
    let inventory: InvRow[] = [];
    if (batchList.length > 0) {
        const inBatches = batchList.map((b) => encodeURIComponent(b.id)).join(',');
        try {
            inventory = await restGet<InvRow[]>(
                `batch_inventory?select=batch_id,total,sold,reserved&batch_id=in.(${inBatches})&limit=500`,
                12_000,
            );
        } catch {
            inventory = [];
        }
    }

    const invByBatch = Object.fromEntries((inventory ?? []).map((row) => [row.batch_id, row]));

    const rows: EventBatchInventoryRow[] = batchList.map((b) => {
        const inv = invByBatch[b.id];
        const total = Number(inv?.total ?? b.quantity ?? 0);
        const sold = Number(inv?.sold ?? 0);
        const reserved = Number(inv?.reserved ?? 0);
        return {
            batch_id: b.id,
            name: b.name ?? '',
            quantity: Number(b.quantity ?? 0),
            price: Number(b.price ?? 0),
            total,
            sold,
            reserved,
            available: Math.max(total - sold - reserved, 0),
            start_date: b.start_date ?? null,
            end_date: b.end_date ?? null,
        };
    });

    const batchTotal = rows.reduce((sum, r) => sum + r.total, 0);

    return {
        event_id: event.id,
        event_title: event.title ?? '',
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
        retry: 1,
        queryFn: () => fetchSummary(eventId!),
    });
}
