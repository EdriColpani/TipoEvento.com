import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AdminContractAcceptanceCompany = {
    company_id: string;
    company_name: string;
    corporate_name: string | null;
    billing_plan: string | null;
};

export type AdminContractAcceptanceRow = {
    id: string;
    user_id: string;
    user_email: string | null;
    user_name: string | null;
    company_id: string | null;
    contract_id: string;
    contract_version: string;
    contract_type: string;
    accepted_at: string;
    contract_title_snapshot: string | null;
    content_hash: string | null;
    acceptance_source: string | null;
    accepted_ip: string | null;
    user_agent: string | null;
    scrolled_to_end: boolean | null;
    metadata: Record<string, unknown> | null;
    current_contract_version: string | null;
    current_contract_is_active: boolean | null;
    content_snapshot_length: number | null;
    content_snapshot: string | null;
};

export type AdminCompanyContractAcceptancesReport = {
    company: {
        id: string;
        corporate_name: string | null;
        trade_name: string | null;
        cnpj: string | null;
        billing_plan: string | null;
        billing_plan_accepted_at: string | null;
        billing_contract_id: string | null;
        contract_version_accepted_id: string | null;
        requires_billing_reacceptance: boolean;
    };
    items: AdminContractAcceptanceRow[];
    total: number;
};

export function useAdminContractAcceptanceCompanies(search?: string, enabled = true) {
    return useQuery({
        queryKey: ['adminContractAcceptanceCompanies', search ?? ''],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_contract_acceptance_companies', {
                p_search: search?.trim() || null,
            });
            if (error) throw error;
            return ((data as { items?: AdminContractAcceptanceCompany[] })?.items ?? []) as AdminContractAcceptanceCompany[];
        },
        enabled,
        staleTime: 30_000,
    });
}

export function useAdminCompanyContractAcceptances(companyId?: string | null) {
    return useQuery({
        queryKey: ['adminCompanyContractAcceptances', companyId],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_company_contract_acceptances', {
                p_company_id: companyId,
            });
            if (error) throw error;
            return data as AdminCompanyContractAcceptancesReport;
        },
        enabled: Boolean(companyId),
        staleTime: 15_000,
    });
}
