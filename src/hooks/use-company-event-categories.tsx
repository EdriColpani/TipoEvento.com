import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type CompanyEventCategory = {
    id: string;
    name: string;
    sort_order: number;
};

async function fetchCompanyEventCategories(companyId: string): Promise<CompanyEventCategory[]> {
    const data = await callRpcRest<Array<{ id: string; name: string; sort_order: number }>>(
        'list_company_event_categories',
        { p_company_id: companyId },
        10_000,
    );
    return (data ?? []).map((row) => ({
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
            const row = await callRpcRest<{ success?: boolean; name?: string; id?: string }>(
                'create_company_event_category',
                { p_company_id: companyId!, p_name: name.trim() },
                12_000,
            );
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
