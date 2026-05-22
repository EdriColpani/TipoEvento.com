import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CompanyEventCategory = {
    id: string;
    name: string;
    sort_order: number;
};

async function fetchCompanyEventCategories(companyId: string): Promise<CompanyEventCategory[]> {
    const { data, error } = await supabase.rpc('list_company_event_categories', {
        p_company_id: companyId,
    });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: { id: string; name: string; sort_order: number }) => ({
        id: row.id,
        name: row.name,
        sort_order: row.sort_order ?? 0,
    }));
}

export function useCompanyEventCategories(companyId: string | undefined) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['companyEventCategories', companyId],
        queryFn: () => fetchCompanyEventCategories(companyId!),
        enabled: Boolean(companyId),
        staleTime: 60_000,
    });

    const createMutation = useMutation({
        mutationFn: async (name: string) => {
            const { data, error } = await supabase.rpc('create_company_event_category', {
                p_company_id: companyId!,
                p_name: name.trim(),
            });
            if (error) throw new Error(error.message);
            const row = data as { success?: boolean; name?: string; id?: string };
            if (!row?.name) throw new Error('Não foi possível criar a categoria.');
            return { id: row.id as string, name: row.name as string };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['companyEventCategories', companyId] });
        },
    });

    return {
        categories: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        createCategory: createMutation.mutateAsync,
        isCreating: createMutation.isPending,
        invalidate: () =>
            queryClient.invalidateQueries({ queryKey: ['companyEventCategories', companyId] }),
    };
}
