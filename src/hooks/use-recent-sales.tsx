import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface RecentSaleData {
    id: string;
    event_title: string;
    tickets_sold: number;
    total_value: number;
    sale_date: string;
    status: string;
}

const fetchRecentSales = async (limit: number = 5): Promise<RecentSaleData[]> => {
    const { data: sales, error } = await supabase
        .from('receivables')
        .select(`
            id,
            created_at,
            total_value,
            status,
            wristband_analytics_ids,
            events ( title )
        `)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error("Erro ao buscar vendas recentes:", error);
        throw error;
    }

    const formattedSales: RecentSaleData[] = sales.map(sale => ({
        id: sale.id,
        event_title: sale.events?.title || 'Evento Desconhecido',
        tickets_sold: sale.wristband_analytics_ids ? sale.wristband_analytics_ids.length : 0,
        total_value: sale.total_value,
        sale_date: format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm'),
        status: 'Confirmado', // Assumimos 'Confirmado' pois filtramos por status 'paid'
    }));

    return formattedSales;
};

export const useRecentSales = (limit: number = 5) => {
    return useQuery<RecentSaleData[]>({ 
        queryKey: ['recentSales', limit],
        queryFn: () => fetchRecentSales(limit),
        staleTime: 1000 * 60 * 1, // 1 minuto
    });
};

