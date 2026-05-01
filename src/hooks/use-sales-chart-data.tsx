import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, format } from 'date-fns';

interface DailySales {
    date: string;
    total_sales: number;
}

const fetchDailySales = async (
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<DailySales[]> => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const today = format(new Date(), 'yyyy-MM-dd');

    // Esta é uma query simplificada. Para um relatório de vendas mais preciso
    // e com performance otimizada, seria ideal criar uma VIEW no Supabase
    // que pré-agregasse esses dados diariamente.
    let query = supabase
        .from('receivables')
        .select('created_at, total_value')
        .gte('created_at', thirtyDaysAgo + 'T00:00:00Z')
        .lte('created_at', today + 'T23:59:59Z')
        .order('created_at', { ascending: true });
    if (!isAdminMaster && userId) {
        query = query.eq('manager_user_id', userId);
    }
    const { data = [], error } = await query.or('status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized');

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
        .sort((a, b) => a.date.localeCompare(b.date));

    return dailySalesData;
};

export const useSalesChartData = (userId?: string, isAdminMaster: boolean = false) => {
    return useQuery<DailySales[]>({ 
        queryKey: ['dailySalesData', userId, isAdminMaster], 
        queryFn: () => fetchDailySales(userId, isAdminMaster),
        enabled: !!userId || isAdminMaster,
        staleTime: 1000 * 60 * 5, // 5 minutos
    });
};

