import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, format } from 'date-fns';

interface DailySales {
    date: string;
    total_sales: number;
}

const fetchDailySales = async (): Promise<DailySales[]> => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const today = format(new Date(), 'yyyy-MM-dd');

    // Esta é uma query simplificada. Para um relatório de vendas mais preciso
    // e com performance otimizada, seria ideal criar uma VIEW no Supabase
    // que pré-agregasse esses dados diariamente.
    const { data, error } = await supabase
        .from('receivables')
        .select('created_at, total_value')
        .eq('status', 'paid')
        .gte('created_at', thirtyDaysAgo + 'T00:00:00Z')
        .lte('created_at', today + 'T23:59:59Z')
        .order('created_at', { ascending: true });

    if (error) throw error;

    const salesMap = new Map<string, number>();

    // Inicializa o map com os últimos 30 dias com 0 vendas
    for (let i = 0; i <= 30; i++) {
        const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
        salesMap.set(date, 0);
    }

    data.forEach(sale => {
        const saleDate = format(new Date(sale.created_at), 'yyyy-MM-dd');
        salesMap.set(saleDate, (salesMap.get(saleDate) || 0) + sale.total_value);
    });

    const dailySalesData: DailySales[] = Array.from(salesMap.entries())
        .map(([date, total_sales]) => ({ date, total_sales }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return dailySalesData;
};

export const useSalesChartData = () => {
    return useQuery<DailySales[]>({ 
        queryKey: ['dailySalesData'], 
        queryFn: fetchDailySales,
        staleTime: 1000 * 60 * 5, // 5 minutos
    });
};

