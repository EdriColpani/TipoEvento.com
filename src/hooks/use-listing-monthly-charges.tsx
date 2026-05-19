import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ListingChargeStatus = 'pending' | 'paid' | 'cancelled';

export interface ListingMonthlyChargeRow {
    id: string;
    company_id: string;
    reference_month: string;
    amount: number;
    status: ListingChargeStatus;
    notes: string | null;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
    company_name?: string;
    company_cnpj?: string | null;
}

async function fetchListingCharges(companyId?: string): Promise<ListingMonthlyChargeRow[]> {
    let query = supabase
        .from('company_listing_monthly_charges')
        .select(
            `
            id, company_id, reference_month, amount, status, notes, paid_at, created_at, updated_at,
            companies ( corporate_name, trade_name, cnpj )
        `,
        )
        .order('reference_month', { ascending: false });

    if (companyId) {
        query = query.eq('company_id', companyId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => {
        const companies = row.companies as
            | { corporate_name: string | null; trade_name: string | null; cnpj: string | null }
            | null
            | undefined;
        return {
            id: row.id,
            company_id: row.company_id,
            reference_month: row.reference_month,
            amount: Number(row.amount),
            status: row.status as ListingChargeStatus,
            notes: row.notes,
            paid_at: row.paid_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            company_name: companies?.trade_name || companies?.corporate_name || undefined,
            company_cnpj: companies?.cnpj ?? null,
        };
    });
}

export function useListingMonthlyCharges(enabled: boolean, companyId?: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['listingMonthlyCharges', companyId ?? 'all'],
        queryFn: () => fetchListingCharges(companyId),
        enabled,
        staleTime: 1000 * 60,
    });

    return {
        charges: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        invalidate: () =>
            queryClient.invalidateQueries({ queryKey: ['listingMonthlyCharges'] }),
    };
}
