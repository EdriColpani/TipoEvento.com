import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { fetchEventsVisibleToGestor } from '@/utils/manager-events-scope';

export interface ManagerEvent {
    id: string;
    title: string;
    is_draft: boolean;
    /** false = desativado (fora da vitrine / sem novas vendas). */
    is_active: boolean;
    date: string;
    company_id: string;
}

const fetchManagerEvents = async (userId: string, isAdminMaster: boolean): Promise<ManagerEvent[]> => {
    if (!userId) {
        console.warn("Attempted to fetch manager events without a userId.");
        return [];
    }

    const rows = await fetchEventsVisibleToGestor(supabase, userId, isAdminMaster);
    const sorted = [...rows].sort((a, b) => {
        const tb = new Date(b.created_at).getTime();
        const ta = new Date(a.created_at).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb)) {
            return tb - ta;
        }
        return (a.title || '').localeCompare(b.title || '', 'pt-BR', { sensitivity: 'base' });
    });

    return sorted.map((e) => ({
        id: e.id,
        title: e.title,
        is_draft: Boolean(e.is_draft ?? false),
        is_active: e.is_active !== false,
        date: e.date ?? '',
        company_id: e.company_id ?? '',
    }));
};

export const useManagerEvents = (userId: string | undefined, isAdminMaster: boolean) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['managerEvents', userId, isAdminMaster], // Adiciona isAdminMaster à chave de cache
        queryFn: () => fetchManagerEvents(userId!, isAdminMaster),
        enabled: !!userId, // Só executa se tiver o userId
        staleTime: 1000 * 60 * 1, // 1 minute
        onError: (error) => {
            console.error("Query Error:", error);
            showError("Erro ao carregar eventos. Tente recarregar a página.");
        }
    });

    return {
        ...query,
        events: query.data || [],
        invalidateEvents: () => queryClient.invalidateQueries({ queryKey: ['managerEvents', userId, isAdminMaster] }),
    };
};