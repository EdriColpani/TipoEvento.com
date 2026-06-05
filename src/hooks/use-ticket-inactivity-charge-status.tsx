import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { companyAllowsTicketSales } from '@/utils/company-billing-rules';
import type { BillingPlanCode } from '@/constants/billing-plans';

export interface TicketInactivityChargeStatus {
    has_pending_charge: boolean;
    is_paid: boolean;
    charge_id?: string;
    amount?: number;
    status?: string;
    reference_month?: string;
}

async function fetchTicketInactivityChargeStatus(
    companyId: string,
): Promise<TicketInactivityChargeStatus> {
    const { data, error } = await supabase.rpc('get_company_ticket_inactivity_charge_status', {
        p_company_id: companyId,
    });
    if (error) throw new Error(error.message);

    const row = (data ?? {}) as Record<string, unknown>;
    return {
        has_pending_charge: row.has_pending_charge === true,
        is_paid: row.is_paid === true,
        charge_id: typeof row.charge_id === 'string' ? row.charge_id : undefined,
        amount: typeof row.amount === 'number' ? row.amount : undefined,
        status: typeof row.status === 'string' ? row.status : undefined,
        reference_month: typeof row.reference_month === 'string' ? row.reference_month : undefined,
    };
}

export function useTicketInactivityChargeStatus(
    companyId: string | undefined,
    billingPlan: BillingPlanCode | null | undefined,
) {
    const enabled = Boolean(companyId && companyAllowsTicketSales(billingPlan ?? null));

    return useQuery({
        queryKey: ['ticketInactivityChargeStatus', companyId],
        queryFn: () => fetchTicketInactivityChargeStatus(companyId!),
        enabled,
        staleTime: 60_000,
        refetchInterval: enabled ? 120_000 : false,
    });
}
