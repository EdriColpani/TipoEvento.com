import { useQuery, useQueryClient } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';

export interface CommissionRange {
    id: string;
    min_tickets: number;
    max_tickets: number;
    percentage: number;
    active: boolean;
    created_at: string;
    updated_at: string;
}

export interface CommissionRangeHistory {
    id: string;
    commission_range_id: string;
    min_tickets: number;
    max_tickets: number;
    percentage: number;
    changed_at: string;
}

/** Tabela ainda não criada no ambiente (migração pendente) — trata como lista vazia. */
function isMissingTableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return message.includes('does not exist') || message.includes('42p01');
}

export async function fetchCommissionRanges(): Promise<CommissionRange[]> {
    try {
        const rows = await restGet<CommissionRange[]>(
            'commission_ranges?select=*&order=min_tickets.asc',
            15_000,
        );
        return rows ?? [];
    } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
    }
}

export async function fetchCommissionRangesHistory(): Promise<CommissionRangeHistory[]> {
    const rows = await restGet<CommissionRangeHistory[]>(
        'commission_ranges_history?select=*&order=changed_at.desc',
        15_000,
    );
    return rows ?? [];
}

export function useCommissionRanges(enabled: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['commissionRanges'],
        queryFn: fetchCommissionRanges,
        enabled,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });

    return {
        ranges: query.data || [],
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        invalidateRanges: () => queryClient.invalidateQueries({ queryKey: ['commissionRanges'] }),
    };
}
