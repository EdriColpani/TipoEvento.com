import { useQuery } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';

interface TopEventData {
    event_id: string;
    event_title: string;
    total_tickets_sold: number;
    total_wristbands_generated: number;
    total_revenue: number;
}

type ReceivableRow = {
    event_id?: string | null;
    total_value?: number;
    wristband_analytics_ids?: unknown;
    events?: { title?: string } | null;
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

async function fetchTopSellingEvents(
    limit: number,
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<TopEventData[]> {
    const scope =
        !isAdminMaster && userId
            ? `&manager_user_id=eq.${encodeURIComponent(userId)}`
            : '';

    const receivables = await restGet<ReceivableRow[]>(
        `receivables?select=event_id,total_value,wristband_analytics_ids,events(title)&${PAID_OR}${scope}&limit=2000`,
        15_000,
    );

    const byEvent = new Map<string, TopEventData>();
    for (const row of receivables ?? []) {
        if (!row.event_id) continue;
        const eventId = String(row.event_id);
        const sold = Array.isArray(row.wristband_analytics_ids)
            ? row.wristband_analytics_ids.length
            : 0;
        const revenue = Number(row.total_value ?? 0);
        const title = row.events?.title || 'Evento sem nome';
        if (!byEvent.has(eventId)) {
            byEvent.set(eventId, {
                event_id: eventId,
                event_title: title,
                total_tickets_sold: 0,
                total_wristbands_generated: 0,
                total_revenue: 0,
            });
        }
        const acc = byEvent.get(eventId)!;
        acc.total_tickets_sold += sold;
        acc.total_revenue += revenue;
    }

    const eventIds = Array.from(byEvent.keys());
    if (eventIds.length > 0) {
        const inList = eventIds.map(encodeURIComponent).join(',');
        try {
            const wristbands = await restGet<Array<{ id: string; event_id: string }>>(
                `wristbands?select=id,event_id&event_id=in.(${inList})&limit=5000`,
                12_000,
            );
            const counts = new Map<string, number>();
            for (const w of wristbands ?? []) {
                counts.set(w.event_id, (counts.get(w.event_id) ?? 0) + 1);
            }
            for (const [eventId, count] of counts) {
                const acc = byEvent.get(eventId);
                if (acc) acc.total_wristbands_generated = count;
            }
        } catch {
            /* ocupação opcional — não bloqueia o ranking */
        }
    }

    return Array.from(byEvent.values())
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, limit);
}

export const useTopSellingEvents = (
    limit: number = 5,
    userId?: string,
    isAdminMaster: boolean = false,
) => {
    return useQuery<TopEventData[]>({
        queryKey: ['topSellingEvents', limit, userId, isAdminMaster],
        queryFn: () => fetchTopSellingEvents(limit, userId, isAdminMaster),
        enabled: !!userId || isAdminMaster,
        staleTime: 1000 * 60 * 5,
        retry: 1,
        placeholderData: [],
    });
};
