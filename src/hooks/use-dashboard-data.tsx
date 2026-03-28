import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';

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

const fetchDashboardData = async (): Promise<DashboardData> => {
    const today = new Date();

    // Definir períodos para o mês atual e mês anterior
    const currentMonthStart = format(startOfMonth(today), 'yyyy-MM-dd HH:mm:ss');
    const currentMonthEnd = format(endOfMonth(today), 'yyyy-MM-dd HH:mm:ss');
    const previousMonthStart = format(startOfMonth(subMonths(today, 1)), 'yyyy-MM-dd HH:mm:ss');
    const previousMonthEnd = format(endOfMonth(subMonths(today, 1)), 'yyyy-MM-dd HH:mm:ss');

    // --- 1. Vendas Totais e Ingressos Vendidos (Mês Atual e Anterior) ---
    const { data: currentMonthSalesData, error: currentMonthSalesError } = await supabase
        .from('receivables')
        .select('total_value, wristband_analytics_ids')
        .eq('status', 'paid')
        .gte('created_at', currentMonthStart)
        .lte('created_at', currentMonthEnd);
    if (currentMonthSalesError) throw currentMonthSalesError;

    const currentMonthTotalSales = currentMonthSalesData.reduce((sum, r) => sum + r.total_value, 0);
    const currentMonthTicketsSold = currentMonthSalesData.reduce((sum, r) => sum + (r.wristband_analytics_ids ? r.wristband_analytics_ids.length : 0), 0);

    const { data: previousMonthSalesData, error: previousMonthSalesError } = await supabase
        .from('receivables')
        .select('total_value, wristband_analytics_ids')
        .eq('status', 'paid')
        .gte('created_at', previousMonthStart)
        .lte('created_at', previousMonthEnd);
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
    const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, status, date'); // Incluir a data para a validação de ativo
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
            (event.status === 'active' || event.status === 'approved') &&
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

    const { data: usedWristbands, error: usedError } = await supabase
        .from('wristband_analytics')
        .select('wristband_id')
        .eq('status', 'used')
        .eq('event_type', 'purchase');
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

export const useDashboardData = () => {
    return useQuery<DashboardData>({
        queryKey: ['dashboardData'],
        queryFn: fetchDashboardData,
        staleTime: 1000 * 60 * 5, // 5 minutos
    });
};

