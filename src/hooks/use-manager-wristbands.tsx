import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

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
        // Para gestores normais, primeiro precisamos do company_id
        const { data: companyData, error: companyError } = await supabase
            .from('user_companies')
            .select('company_id')
            .eq('user_id', userId)
            .eq('is_primary', true)
            .limit(1)
            .single();

        if (companyError && companyError.code !== 'PGRST116') {
            console.error("Error fetching company ID for manager wristbands:", companyError);
            throw new Error(companyError.message);
        }

        if (!companyData?.company_id) {
            console.warn("Manager has no primary company associated. Returning empty wristband list.");
            return [];
        }
        query = query.eq('company_id', companyData.company_id);
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