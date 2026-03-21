import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';

export interface WristbandData {
    id: string;
    code: string;
    access_type: string;
    status: 'active' | 'used' | 'lost' | 'cancelled';
    created_at: string;
    event_id: string;
    
    // Dados do evento associado (join)
    events: {
        title: string;
        date: string; // Adicionado: data do evento
    } | null;
}

const fetchManagerWristbands = async (userId: string, isAdminMaster: boolean): Promise<WristbandData[]> => {
    if (!userId) {
        console.warn("Attempted to fetch wristbands without a userId.");
        return [];
    }

    let query = supabase
        .from('wristbands')
        .select(`
            id,
            code,
            access_type,
            status,
            created_at,
            event_id,
            events!event_id (title, date) -- Adicionado: data do evento para o QR Code. Especificando relacionamento explícito via event_id para evitar erro PGRST201
        `)
        .order('created_at', { ascending: false });

    if (!isAdminMaster) {
        const primaryCompanyId = await fetchManagerPrimaryCompanyId(supabase, userId);
        if (primaryCompanyId) {
            query = query.or(`company_id.eq.${primaryCompanyId},manager_user_id.eq.${userId}`);
        } else {
            query = query.eq('manager_user_id', userId);
        }
    }
    // Se for isAdminMaster, nenhum filtro de company_id é aplicado,
    // e a RLS no banco de dados já garante o acesso total.

    const { data, error } = await query;

    if (error) {
        console.error("Error fetching manager wristbands from Supabase:", error);
        throw new Error(error.message); 
    }
    
    return data as WristbandData[];
};

export const useManagerWristbands = (userId: string | undefined, isAdminMaster: boolean) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['managerWristbands', userId, isAdminMaster], // Adiciona isAdminMaster à chave de cache
        queryFn: () => fetchManagerWristbands(userId!, isAdminMaster),
        enabled: !!userId, // Só executa se tiver o userId
        staleTime: 1000 * 30, // 30 seconds
        onError: (error) => {
            console.error("Query Error:", error);
            showError("Erro ao carregar lista de pulseiras.");
        }
    });

    return {
        ...query,
        wristbands: query.data || [],
        invalidateWristbands: () => queryClient.invalidateQueries({ queryKey: ['managerWristbands', userId, isAdminMaster] }),
    };
};