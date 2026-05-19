import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode, CompanyBillingFields } from '@/constants/billing-plans';

export interface CompanyBillingRow extends CompanyBillingFields {
    id: string;
    corporate_name: string | null;
    billing_contract_version?: string | null;
}

const BILLING_SELECT =
    'id, corporate_name, billing_plan, billing_plan_accepted_at, billing_contract_id, billing_plan_locked_until, requires_billing_reacceptance, billing_contract:event_contracts!billing_contract_id(version)';

async function fetchCompanyBilling(companyId: string): Promise<CompanyBillingRow | null> {
    const { data, error } = await supabase
        .from('companies')
        .select(BILLING_SELECT)
        .eq('id', companyId)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        throw new Error(error.message);
    }
    if (!data) return null;

    const row = data as Record<string, unknown>;
    const nested = row.billing_contract as { version?: string } | null | undefined;

    return {
        id: row.id as string,
        corporate_name: row.corporate_name as string | null,
        billing_plan: (row.billing_plan as BillingPlanCode | null) ?? null,
        billing_plan_accepted_at: row.billing_plan_accepted_at as string | null,
        billing_contract_id: row.billing_contract_id as string | null,
        billing_plan_locked_until: row.billing_plan_locked_until as string | null,
        requires_billing_reacceptance: Boolean(row.requires_billing_reacceptance),
        billing_contract_version: nested?.version ?? null,
    };
}

export function useCompanyBilling(companyId: string | undefined) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['companyBilling', companyId],
        queryFn: () => fetchCompanyBilling(companyId!),
        enabled: !!companyId,
        staleTime: 1000 * 60 * 2,
    });

    return {
        ...query,
        billing: query.data,
        invalidate: () => queryClient.invalidateQueries({ queryKey: ['companyBilling', companyId] }),
    };
}
