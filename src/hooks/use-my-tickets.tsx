import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

export interface TicketData {
    id: string;
    status: 'active' | 'used' | 'lost' | 'cancelled' | 'pending'; // NOVO: Adicionado 'pending'
    created_at: string;
    event_type: string;
    event_data: {
        purchase_date?: string;
        total_paid?: number;
        unit_price?: number;
        access_type?: string;
    };
    
    // Dados do Evento (JOIN)
    wristbands: {
        access_type: string;
        price: number;
        events: {
            id: string;
            title: string;
            location: string;
            date: string;
        } | null;
    } | null;
}

const fetchMyTickets = async (userId: string): Promise<TicketData[]> => {
    if (!userId) return [];

    // Busca todos os registros de analytics associados ao usuário logado
    // Especificando relacionamentos explícitos para evitar erros PGRST201
    const { data, error } = await supabase
        .from('wristband_analytics')
        .select(`
            id,
            status,
            created_at,
            event_type,
            event_data,
            wristbands!wristband_id (
                access_type,
                price,
                events!event_id (
                    id,
                    title,
                    location,
                    date
                )
            )
        `)
        .eq('client_user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching user tickets:", error);
        throw new Error(error.message);
    }
    
    // Filtra e mapeia para garantir que apenas registros válidos sejam retornados
    return data.filter(ticket => ticket.wristbands?.events) as TicketData[];
};

export const useMyTickets = (userId: string | undefined) => {
    const query = useQuery({
        queryKey: ['myTickets', userId],
        queryFn: () => fetchMyTickets(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 1, // 1 minute
        onError: (error) => {
            console.error("Query Error: Failed to load user tickets.", error);
            showError("Erro ao carregar seus ingressos. Tente recarregar a página.");
        }
    });

    return {
        ...query,
        tickets: query.data || [],
    };
};