import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import type { EventEditSalesGuard } from '@/utils/event-edit-sales-guard';

async function fetchEventEditSalesGuard(eventId: string): Promise<EventEditSalesGuard> {
    const raw = await callRpcRest<Record<string, unknown>>(
        'get_event_edit_sales_guard',
        { p_event_id: eventId },
        12_000,
    );

    return {
        sold_count: Number(raw.sold_count ?? 0),
        paid_receivables_count: Number(raw.paid_receivables_count ?? 0),
        free_registrations_count: Number(raw.free_registrations_count ?? 0),
        has_sales: Boolean(raw.has_sales),
        min_capacity: Math.max(1, Number(raw.min_capacity ?? 1)),
    };
}

export function useEventEditSalesGuard(eventId: string | undefined) {
    return useQuery({
        queryKey: ['eventEditSalesGuard', eventId],
        queryFn: () => fetchEventEditSalesGuard(eventId!),
        enabled: Boolean(eventId),
        staleTime: 1000 * 30,
    });
}
