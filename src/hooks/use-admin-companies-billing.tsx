import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode } from '@/constants/billing-plans';

export interface AdminCompanyBillingRow {
    id: string;
    corporate_name: string | null;
    trade_name: string | null;
    cnpj: string | null;
    email: string | null;
    billing_plan: BillingPlanCode | null;
    billing_plan_accepted_at: string | null;
    billing_contract_id: string | null;
    billing_plan_locked_until: string | null;
    requires_billing_reacceptance: boolean;
    listing_monthly_fee: number | null;
    consumption_license_fee: number | null;
    created_at: string;
}

export interface CompanyBillingHistoryRow {
    id: string;
    company_id: string;
    from_plan: BillingPlanCode | null;
    to_plan: BillingPlanCode;
    changed_by: string | null;
    change_type: string;
    created_at: string;
}

async function fetchAdminCompaniesBilling(): Promise<AdminCompanyBillingRow[]> {
    const { data, error } = await supabase
        .from('companies')
        .select(
            'id, corporate_name, trade_name, cnpj, email, billing_plan, billing_plan_accepted_at, billing_contract_id, billing_plan_locked_until, requires_billing_reacceptance, listing_monthly_fee, consumption_license_fee, created_at',
        )
        .order('corporate_name', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as AdminCompanyBillingRow[];
}

async function fetchCompanyBillingHistory(companyId: string): Promise<CompanyBillingHistoryRow[]> {
    const { data, error } = await supabase
        .from('company_billing_plan_history')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) throw new Error(error.message);
    return (data ?? []) as CompanyBillingHistoryRow[];
}

export function useAdminCompaniesBilling(enabled: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['adminCompaniesBilling'],
        queryFn: fetchAdminCompaniesBilling,
        enabled,
        staleTime: 1000 * 60 * 2,
    });

    return {
        companies: query.data ?? [],
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        invalidate: () => queryClient.invalidateQueries({ queryKey: ['adminCompaniesBilling'] }),
    };
}

export function useCompanyBillingHistory(companyId: string | null, enabled: boolean) {
    return useQuery({
        queryKey: ['companyBillingHistory', companyId],
        queryFn: () => fetchCompanyBillingHistory(companyId!),
        enabled: enabled && !!companyId,
    });
}
