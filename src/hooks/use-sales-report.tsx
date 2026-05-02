import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

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

const RECEIVABLE_PAID_OR =
    'status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized';

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
    let query = supabase
        .from('receivables')
        .select(`
            id,
            total_value,
            created_at,
            event_id,
            wristband_analytics_ids,
            events!inner (
                id,
                title
            )
        `);

    if (!isAdminMaster && managerUserId) {
        query = query.eq('manager_user_id', managerUserId);
    }

    if (filters.eventId) {
        query = query.eq('event_id', filters.eventId);
    }

    if (filters.startDate) {
        query = query.gte('created_at', `${filters.startDate}T00:00:00.000Z`);
    }
    if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query = query.lte('created_at', end.toISOString());
    }

    const { data: receivables, error } = await query.or(RECEIVABLE_PAID_OR);
    if (error) throw error;
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

    for (const r of receivables as any[]) {
        const eventId = r.event_id as string;
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
        staleTime: 60_000,
    });
};
