import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface TopEventData {
    event_id: string;
    event_title: string;
    total_tickets_sold: number;
    total_wristbands_generated: number; // Para calcular a porcentagem de ocupação
    total_revenue: number;
}

const fetchTopSellingEvents = async (
    limit: number = 5,
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<TopEventData[]> => {
    let receivablesQuery = supabase
        .from('receivables')
        .select(`
            event_id,
            total_value,
            wristband_analytics_ids,
            events (
                title
            )
        `);
    if (!isAdminMaster && userId) {
        receivablesQuery = receivablesQuery.eq('manager_user_id', userId);
    }
    const { data: receivables = [], error: receivablesError } = await receivablesQuery.or(
        'status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized',
    );
    if (receivablesError) {
        console.error("Erro ao buscar receivables para top eventos:", receivablesError);
        throw receivablesError;
    }

    const byEvent = new Map<string, TopEventData>();
    receivables.forEach((row: any) => {
        if (!row.event_id) return;
        const eventId = row.event_id as string;
        const sold = Array.isArray(row.wristband_analytics_ids) ? row.wristband_analytics_ids.length : 0;
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
    });

    const eventIds = Array.from(byEvent.keys());
    if (eventIds.length > 0) {
        const { data: wristbands = [], error: wristbandsError } = await supabase
            .from('wristbands')
            .select('id, event_id')
            .in('event_id', eventIds);
        if (wristbandsError) throw wristbandsError;

        const wristbandIds = wristbands.map((w: any) => w.id);
        if (wristbandIds.length > 0) {
            const eventIdByWristband = new Map<string, string>(
                wristbands.map((w: any) => [w.id, w.event_id]),
            );
            const { data: analytics = [], error: analyticsError } = await supabase
                .from('wristband_analytics')
                .select('wristband_id')
                .in('wristband_id', wristbandIds);
            if (analyticsError) throw analyticsError;

            analytics.forEach((a: any) => {
                const eventId = eventIdByWristband.get(a.wristband_id);
                if (!eventId) return;
                const acc = byEvent.get(eventId);
                if (!acc) return;
                acc.total_wristbands_generated += 1;
            });
        }
    }

    return Array.from(byEvent.values())
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, limit);
};

export const useTopSellingEvents = (limit: number = 5, userId?: string, isAdminMaster: boolean = false) => {
    return useQuery<TopEventData[]>({ 
        queryKey: ['topSellingEvents', limit, userId, isAdminMaster],
        queryFn: () => fetchTopSellingEvents(limit, userId, isAdminMaster),
        enabled: !!userId || isAdminMaster,
        staleTime: 1000 * 60 * 5, // 5 minutos
    });
};

