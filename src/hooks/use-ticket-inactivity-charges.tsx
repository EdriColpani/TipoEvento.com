import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type TicketInactivityChargeStatus = 'pending' | 'paid' | 'cancelled';

export interface TicketInactivityChargeRow {
    id: string;
    company_id: string;
    reference_month: string;
    amount: number;
    status: TicketInactivityChargeStatus;
    consecutive_months: number;
    notes: string | null;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
    company_name?: string;
    company_cnpj?: string | null;
}

async function fetchTicketInactivityCharges(): Promise<TicketInactivityChargeRow[]> {
    const { data, error } = await supabase
        .from('company_ticket_inactivity_charges')
        .select(
            `
            id, company_id, reference_month, amount, status, consecutive_months, notes, paid_at, created_at, updated_at,
            companies ( corporate_name, trade_name, cnpj )
        `,
        )
        .order('reference_month', { ascending: false });

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
            status: row.status as TicketInactivityChargeStatus,
            consecutive_months: Number(row.consecutive_months ?? 2),
            notes: row.notes,
            paid_at: row.paid_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            company_name: companies?.trade_name || companies?.corporate_name || undefined,
            company_cnpj: companies?.cnpj ?? null,
        };
    });
}

export function useTicketInactivityCharges(enabled: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['ticketInactivityCharges'],
        queryFn: fetchTicketInactivityCharges,
        enabled,
        staleTime: 1000 * 60,
    });

    return {
        charges: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        invalidate: () => queryClient.invalidateQueries({ queryKey: ['ticketInactivityCharges'] }),
    };
}
