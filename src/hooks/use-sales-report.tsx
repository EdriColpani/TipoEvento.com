import { useQuery } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';

export interface SalesReportRow {
    event_id: string;
    event_title: string;
    total_sales_value: number;
    total_tickets_sold: number;
    /** Valor médio por ingresso = total_sales_value / total_tickets_sold */
    average_ticket_price: number;
}

export interface SalesReportFilters {
    eventId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
}

type SalesReceivableRow = {
    id: string;
    total_value: number | null;
    created_at: string;
    event_id: string;
    wristband_analytics_ids: unknown;
    events: { id: string; title: string } | null;
};

function ticketCountFromReceivable(row: { wristband_analytics_ids?: unknown }): number {
    const ids = row.wristband_analytics_ids;
    if (Array.isArray(ids) && ids.length > 0) return ids.length;
    return 1;
}

export async function fetchSalesReport(
    managerUserId: string | undefined,
    isAdminMaster: boolean,
    filters: SalesReportFilters,
): Promise<SalesReportRow[]> {
    const params: string[] = [
        'select=id,total_value,created_at,event_id,wristband_analytics_ids,events!inner(id,title)',
        'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)',
    ];

    if (!isAdminMaster && managerUserId) {
        params.push(`manager_user_id=eq.${encodeURIComponent(managerUserId)}`);
    }
    if (filters.eventId) {
        params.push(`event_id=eq.${encodeURIComponent(filters.eventId)}`);
    }
    if (filters.startDate) {
        params.push(`created_at=gte.${encodeURIComponent(`${filters.startDate}T00:00:00.000Z`)}`);
    }
    if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        params.push(`created_at=lte.${encodeURIComponent(end.toISOString())}`);
    }

    const receivables = await restGet<SalesReceivableRow[]>(
        `receivables?${params.join('&')}`,
        15_000,
    );

    if (!receivables?.length) return [];

    const byEvent = new Map<
        string,
        {
            event_id: string;
            event_title: string;
            total_sales_value: number;
            total_tickets_sold: number;
        }
    >();

    for (const r of receivables) {
        const eventId = r.event_id;
        if (!eventId) continue;
        const title = r.events?.title || 'Evento';
        const value = Number(r.total_value ?? 0);
        const tickets = ticketCountFromReceivable(r);

        if (!byEvent.has(eventId)) {
            byEvent.set(eventId, {
                event_id: eventId,
                event_title: title,
                total_sales_value: 0,
                total_tickets_sold: 0,
            });
        }
        const acc = byEvent.get(eventId)!;
        acc.total_sales_value += value;
        acc.total_tickets_sold += tickets;
    }

    const rows: SalesReportRow[] = [];
    byEvent.forEach((acc) => {
        const avg =
            acc.total_tickets_sold > 0 ? acc.total_sales_value / acc.total_tickets_sold : 0;
        rows.push({
            event_id: acc.event_id,
            event_title: acc.event_title,
            total_sales_value: acc.total_sales_value,
            total_tickets_sold: acc.total_tickets_sold,
            average_ticket_price: avg,
        });
    });

    return rows.sort((a, b) => b.total_sales_value - a.total_sales_value);
}

export const useSalesReport = (
    managerUserId: string | undefined,
    isAdminMaster: boolean,
    filters: SalesReportFilters,
    enabled: boolean,
) => {
    return useQuery({
        queryKey: ['sales-report', managerUserId, isAdminMaster, filters],
        queryFn: () => fetchSalesReport(managerUserId, isAdminMaster, filters),
        enabled,
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
    });
};
