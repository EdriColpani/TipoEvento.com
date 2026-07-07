import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export const ADMIN_CONTACT_INBOX_QUERY_KEY = ['adminContactInboxSummary'] as const;

async function fetchAdminContactInboxSummary(): Promise<number> {
    try {
        const row = await callRpcRest<{ new_count?: number }>('get_admin_contact_inbox_summary', {}, 10_000);
        return Number(row.new_count ?? 0);
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('function')) return 0;
        throw error;
    }
}

export function useAdminContactInboxSummary(enabled: boolean) {
    const query = useQuery({
        queryKey: [...ADMIN_CONTACT_INBOX_QUERY_KEY],
        queryFn: fetchAdminContactInboxSummary,
        enabled,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

    return {
        newCount: query.data ?? 0,
        isLoading: query.isLoading,
        isError: query.isError,
    };
}
