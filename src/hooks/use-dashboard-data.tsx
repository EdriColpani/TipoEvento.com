import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { subDays, format } from 'date-fns';

interface SalesMetrics {
    currentMonthTotalSales: number;
    previousMonthTotalSales: number;
    salesPercentageChange: number; // Positivo para aumento, negativo para queda
    currentMonthTicketsSold: number;
    previousMonthTicketsSold: number;
    ticketsPercentageChange: number;
}

interface EventMetrics {
    activeEvents: number;
    totalEvents: number;
}

interface OccupancyMetrics {
    occupancyRate: number;
}

export interface DashboardData {
    sales: SalesMetrics;
    events: EventMetrics;
    occupancy: OccupancyMetrics;
}

const applyPaidLikeFilter = <T,>(query: T & { or: (filters: string) => T }): T =>
    query.or('status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized');

const fetchDashboardData = async (
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<DashboardData> => {
    const today = new Date();

    // Períodos móveis de 30 dias para evitar zerar no início do mês.
    const currentWindowStart = format(subDays(today, 30), 'yyyy-MM-dd HH:mm:ss');
    const currentWindowEnd = format(today, 'yyyy-MM-dd HH:mm:ss');
    const previousWindowStart = format(subDays(today, 60), 'yyyy-MM-dd HH:mm:ss');
    const previousWindowEnd = format(subDays(today, 31), 'yyyy-MM-dd HH:mm:ss');

    // --- 1. Vendas Totais e Ingressos Vendidos (Mês Atual e Anterior) ---
    let currentSalesQuery = supabase
        .from('receivables')
        .select('total_value, wristband_analytics_ids')
        .gte('created_at', currentWindowStart)
        .lte('created_at', currentWindowEnd);
    if (!isAdminMaster && userId) {
        currentSalesQuery = currentSalesQuery.eq('manager_user_id', userId);
    }
    const { data: currentMonthSalesData = [], error: currentMonthSalesError } = await applyPaidLikeFilter(currentSalesQuery);
    if (currentMonthSalesError) throw currentMonthSalesError;

    const currentMonthTotalSales = currentMonthSalesData.reduce((sum, r) => sum + r.total_value, 0);
    const currentMonthTicketsSold = currentMonthSalesData.reduce((sum, r) => sum + (r.wristband_analytics_ids ? r.wristband_analytics_ids.length : 0), 0);

    let previousSalesQuery = supabase
        .from('receivables')
        .select('total_value, wristband_analytics_ids')
        .gte('created_at', previousWindowStart)
        .lte('created_at', previousWindowEnd);
    if (!isAdminMaster && userId) {
        previousSalesQuery = previousSalesQuery.eq('manager_user_id', userId);
    }
    const { data: previousMonthSalesData = [], error: previousMonthSalesError } = await applyPaidLikeFilter(previousSalesQuery);
    if (previousMonthSalesError) throw previousMonthSalesError;

    const previousMonthTotalSales = previousMonthSalesData.reduce((sum, r) => sum + r.total_value, 0);
    const previousMonthTicketsSold = previousMonthSalesData.reduce((sum, r) => sum + (r.wristband_analytics_ids ? r.wristband_analytics_ids.length : 0), 0);

    const salesPercentageChange = previousMonthTotalSales === 0 
        ? (currentMonthTotalSales > 0 ? 100 : 0) 
        : ((currentMonthTotalSales - previousMonthTotalSales) / previousMonthTotalSales) * 100;

    const ticketsPercentageChange = previousMonthTicketsSold === 0 
        ? (currentMonthTicketsSold > 0 ? 100 : 0) 
        : ((currentMonthTicketsSold - previousMonthTicketsSold) / previousMonthTicketsSold) * 100;

    // --- 2. Eventos Ativos e Total de Eventos ---
    let eventsQuery = supabase
        .from('events')
        .select('id, is_active, date');
    if (!isAdminMaster && userId) {
        eventsQuery = eventsQuery.eq('created_by', userId);
    }
    const { data: eventsData = [], error: eventsError } = await eventsQuery;
    if (eventsError) throw eventsError;

    const totalEvents = eventsData.length;
    const todayAdjustedForComparison = new Date();
    todayAdjustedForComparison.setHours(0, 0, 0, 0); // Zera a hora para comparar apenas a data

    const activeEvents = eventsData.filter((event) => {
        const eventStartDate = parseEventLocalDay(event.date);
        if (!eventStartDate) return false;
        const day = new Date(
            eventStartDate.getFullYear(),
            eventStartDate.getMonth(),
            eventStartDate.getDate(),
            0,
            0,
            0,
            0,
        );

        return (
            event.is_active !== false &&
            day >= todayAdjustedForComparison
        );
    }).length;

    // --- 3. Taxa de Ocupação Geral ---
    // Para simplificar, vamos considerar a taxa de ocupação como (total de pulseiras usadas / total de pulseiras geradas)
    // Poderia ser mais complexo, como por evento ativo, etc.
    const { count: totalWristbandsGenerated, error: generatedError } = await supabase
        .from('wristbands')
        .select('id', { count: 'exact' });
    if (generatedError) throw generatedError;

    const { data: usedWristbands = [], error: usedError } = await supabase
        .from('wristband_analytics')
        .select('wristband_id')
        .eq('event_type', 'purchase')
        .not('client_user_id', 'is', null);
    if (usedError) throw usedError;

    const distinctUsedWristbandIds = new Set(usedWristbands.map(wa => wa.wristband_id));
    const totalWristbandsUsed = distinctUsedWristbandIds.size;

    const occupancyRate = (totalWristbandsGenerated && totalWristbandsGenerated > 0)
        ? (totalWristbandsUsed / totalWristbandsGenerated) * 100
        : 0;

    return {
        sales: {
            currentMonthTotalSales,
            previousMonthTotalSales,
            salesPercentageChange,
            currentMonthTicketsSold,
            previousMonthTicketsSold,
            ticketsPercentageChange,
        },
        events: {
            activeEvents,
            totalEvents,
        },
        occupancy: {
            occupancyRate,
        },
    };
};

export const useDashboardData = (userId?: string, isAdminMaster: boolean = false) => {
    return useQuery<DashboardData>({
        queryKey: ['dashboardData', userId, isAdminMaster],
        queryFn: () => fetchDashboardData(userId, isAdminMaster),
        enabled: !!userId || isAdminMaster,
        staleTime: 1000 * 60 * 5, // 5 minutos
    });
};

