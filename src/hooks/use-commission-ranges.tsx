import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

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

export async function fetchCommissionRanges(): Promise<CommissionRange[]> {
    const { data, error } = await supabase
        .from('commission_ranges')
        .select('*')
        .order('min_tickets', { ascending: true });

    if (error) {
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
            return [];
        }
        throw new Error(error.message);
    }

    return (data || []) as CommissionRange[];
}

export async function fetchCommissionRangesHistory(): Promise<CommissionRangeHistory[]> {
    const { data, error } = await supabase
        .from('commission_ranges_history')
        .select('*')
        .order('changed_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data as CommissionRangeHistory[];
}

export function useCommissionRanges(enabled: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['commissionRanges'],
        queryFn: fetchCommissionRanges,
        enabled,
        staleTime: 1000 * 60 * 5,
        onError: () => {
            showError('Erro ao carregar as faixas de comissão.');
        },
    });

    return {
        ranges: query.data || [],
        isLoading: query.isLoading,
        isError: query.isError,
        invalidateRanges: () => queryClient.invalidateQueries({ queryKey: ['commissionRanges'] }),
    };
}
