import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type ManagerContractAcceptanceRow = {
    id: string;
    contract_id: string;
    contract_version: string;
    contract_type: string;
    accepted_at: string;
    contract_title_snapshot: string | null;
    content_hash: string | null;
    document_hash: string | null;
    acceptance_source: string | null;
    verification_method: string | null;
    verification_channel: string | null;
    verified_at: string | null;
    pdf_storage_path: string | null;
    pdf_generated_at: string | null;
    commercial_terms_snapshot: Record<string, unknown> | null;
    party_snapshot: Record<string, unknown> | null;
    scrolled_to_end: boolean | null;
    current_contract_version: string | null;
    current_contract_is_active: boolean | null;
};

export function useManagerCompanyContractAcceptances(companyId?: string | null) {
    return useQuery({
        queryKey: ['managerCompanyContractAcceptances', companyId],
        queryFn: async () => {
            const data = await callRpcRest<{
                items?: ManagerContractAcceptanceRow[];
                total?: number;
            }>('list_manager_company_contract_acceptances', { p_company_id: companyId }, 15_000);
            return {
                items: data?.items ?? [],
                total: data?.total ?? 0,
            };
        },
        enabled: Boolean(companyId),
        staleTime: 15_000,
    });
}
