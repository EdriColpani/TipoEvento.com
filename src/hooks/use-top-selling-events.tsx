import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface TopEventData {
    event_id: string;
    event_title: string;
    total_tickets_sold: number;
    total_wristbands_generated: number; // Para calcular a porcentagem de ocupação
    total_revenue: number;
}

const fetchTopSellingEvents = async (limit: number = 5): Promise<TopEventData[]> => {
    // Esta query é complexa porque precisa: 
    // 1. Contar ingressos vendidos por evento (de wristband_analytics)
    // 2. Contar ingressos gerados por evento (de wristbands)
    // 3. Somar a receita por evento (de receivables)
    // 4. Juntar com a tabela events para o título do evento

    const { data, error } = await supabase.rpc('get_top_selling_events', { p_limit: limit });

    if (error) {
        console.error("Erro ao buscar eventos mais vendidos:", error);
        throw error;
    }

    return data as TopEventData[];
};

export const useTopSellingEvents = (limit: number = 5) => {
    return useQuery<TopEventData[]>({ 
        queryKey: ['topSellingEvents', limit],
        queryFn: () => fetchTopSellingEvents(limit),
        staleTime: 1000 * 60 * 5, // 5 minutos
    });
};

