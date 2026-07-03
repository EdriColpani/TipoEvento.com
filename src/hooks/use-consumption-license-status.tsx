import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isConsumptionOrLicensePlan } from '@/utils/company-billing-rules';
import type { BillingPlanCode } from '@/constants/billing-plans';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

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
    try {
        const data = await callRpcRest<Record<string, unknown>>(
            'get_company_consumption_license_status',
            { p_company_id: companyId },
            8_000,
        );
        return {
            requires_license: data.requires_license === true,
            is_paid: data.is_paid === true,
            blocks_consumption: data.blocks_consumption === true,
            charge_id: typeof data.charge_id === 'string' ? data.charge_id : undefined,
            amount: typeof data.amount === 'number' ? data.amount : undefined,
            status: typeof data.status === 'string' ? data.status : undefined,
            reference_month: typeof data.reference_month === 'string' ? data.reference_month : undefined,
        };
    } catch (restError) {
        console.warn('[useConsumptionLicenseStatus] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('get_company_consumption_license_status', { p_company_id: companyId }),
        8_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );
    if (error?.message && error.message !== 'timeout') throw new Error(error.message);

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
