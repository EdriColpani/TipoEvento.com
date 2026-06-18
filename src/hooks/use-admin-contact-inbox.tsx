import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const ADMIN_CONTACT_INBOX_QUERY_KEY = ['adminContactInboxSummary'] as const;

async function fetchAdminContactInboxSummary(): Promise<number> {
    const { data, error } = await supabase.rpc('get_admin_contact_inbox_summary');
    if (error) {
        if (error.message?.includes('function') || error.code === '42883') {
            return 0;
        }
        throw new Error(error.message);
    }
    const row = (data ?? {}) as { new_count?: number };
    return Number(row.new_count ?? 0);
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
