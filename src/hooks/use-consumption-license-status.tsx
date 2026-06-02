import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isConsumptionOrLicensePlan } from '@/utils/company-billing-rules';
import type { BillingPlanCode } from '@/constants/billing-plans';

export interface ConsumptionLicenseStatus {
    requires_license: boolean;
    is_paid: boolean;
    blocks_consumption: boolean;
    charge_id?: string;
    amount?: number;
    status?: string;
    reference_month?: string;
}

async function fetchConsumptionLicenseStatus(companyId: string): Promise<ConsumptionLicenseStatus> {
    const { data, error } = await supabase.rpc('get_company_consumption_license_status', {
        p_company_id: companyId,
    });
    if (error) throw new Error(error.message);

    const row = (data ?? {}) as Record<string, unknown>;
    return {
        requires_license: row.requires_license === true,
        is_paid: row.is_paid === true,
        blocks_consumption: row.blocks_consumption === true,
        charge_id: typeof row.charge_id === 'string' ? row.charge_id : undefined,
        amount: typeof row.amount === 'number' ? row.amount : undefined,
        status: typeof row.status === 'string' ? row.status : undefined,
        reference_month: typeof row.reference_month === 'string' ? row.reference_month : undefined,
    };
}

export function useConsumptionLicenseStatus(
    companyId: string | undefined,
    billingPlan: BillingPlanCode | null | undefined,
) {
    const enabled = Boolean(companyId && isConsumptionOrLicensePlan(billingPlan ?? null));

    return useQuery({
        queryKey: ['consumptionLicenseStatus', companyId],
        queryFn: () => fetchConsumptionLicenseStatus(companyId!),
        enabled,
        staleTime: 60_000,
        refetchInterval: enabled ? 120_000 : false,
    });
}
