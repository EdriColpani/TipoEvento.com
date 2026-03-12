import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subMonths, getMonth, getYear } from 'date-fns';

interface MonthlyRevenueDataPoint {
    month: string; // Ex: "Jan/2026"
    total_revenue: number;
}

const fetchMonthlyRevenueData = async (monthsBack: number = 6): Promise<MonthlyRevenueDataPoint[]> => {
    const today = new Date();
    const startDate = subMonths(today, monthsBack - 1); // Ex: para 6 meses, começa 5 meses atrás

    const { data: salesData, error } = await supabase
        .from('receivables')
        .select('created_at, total_value')
        .eq('status', 'paid')
        .gte('created_at', format(startDate, 'yyyy-MM-dd HH:mm:ss'))
        .lte('created_at', format(today, 'yyyy-MM-dd HH:mm:ss'))
        .order('created_at', { ascending: true });

    if (error) throw error;

    const monthlyRevenueMap = new Map<string, number>();

    // Inicializa o mapa com 0 para todos os meses do período
    for (let i = 0; i < monthsBack; i++) {
        const date = subMonths(today, monthsBack - 1 - i);
        const monthKey = format(date, 'MMM/yyyy'); // Ex: Jan/2026
        monthlyRevenueMap.set(monthKey, 0);
    }

    salesData.forEach(sale => {
        const saleDate = new Date(sale.created_at);
        const monthKey = format(saleDate, 'MMM/yyyy');
        monthlyRevenueMap.set(monthKey, (monthlyRevenueMap.get(monthKey) || 0) + sale.total_value);
    });

    const result: MonthlyRevenueDataPoint[] = Array.from(monthlyRevenueMap.entries()).map(([month, total_revenue]) => ({
        month,
        total_revenue,
    }));

    // Ordena os resultados por data (garante que o gráfico seja exibido corretamente)
    result.sort((a, b) => {
        const [monthA, yearA] = a.month.split('/');
        const [monthB, yearB] = b.month.split('/');
        const dateA = new Date(parseInt(yearA), parseInt(getMonthNumber(monthA)));
        const dateB = new Date(parseInt(yearB), parseInt(getMonthNumber(monthB)));
        return dateA.getTime() - dateB.getTime();
    });

    return result;
};

const getMonthNumber = (monthAbbr: string) => {
    const monthMap: { [key: string]: number } = {
        'Jan': 0, 'Fev': 1, 'Mar': 2, 'Abr': 3, 'Mai': 4, 'Jun': 5,
        'Jul': 6, 'Ago': 7, 'Set': 8, 'Out': 9, 'Nov': 10, 'Dez': 11
    };
    return monthMap[monthAbbr];
};

export const useMonthlyRevenueData = (monthsBack: number = 6) => {
    return useQuery<MonthlyRevenueDataPoint[]>({ 
        queryKey: ['monthlyRevenueData', monthsBack],
        queryFn: () => fetchMonthlyRevenueData(monthsBack),
        staleTime: 1000 * 60 * 5, // 5 minutos
    });
};

