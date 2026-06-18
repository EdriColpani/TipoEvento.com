export type ContractAcceptanceSource =
    | 'profile'
    | 'billing'
    | 'billing_upgrade'
    | 'manager_register'
    | 'web';

export type ContractAcceptanceAuditMeta = {
    acceptanceSource: ContractAcceptanceSource;
    scrolledToEnd?: boolean | null;
    acceptedIp?: string | null;
    metadata?: Record<string, unknown>;
};

export function buildContractAcceptanceAuditMeta(
    acceptanceSource: ContractAcceptanceSource,
    options?: {
        scrolledToEnd?: boolean | null;
        acceptedIp?: string | null;
        metadata?: Record<string, unknown>;
    },
): ContractAcceptanceAuditMeta {
    const userAgent =
        typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 2000) : null;

    return {
        acceptanceSource,
        scrolledToEnd: options?.scrolledToEnd ?? null,
        acceptedIp: options?.acceptedIp ?? null,
        metadata: {
            ...(options?.metadata ?? {}),
            user_agent: userAgent,
            recorded_at_client: new Date().toISOString(),
        },
    };
}

export async function recordContractAcceptance(params: {
    contractId: string;
    contractType: string;
    companyId?: string | null;
    userId?: string | null;
    audit: ContractAcceptanceAuditMeta;
}) {
    const { supabase } = await import('@/integrations/supabase/client');

    const { data, error } = await supabase.rpc('register_contract_acceptance', {
        p_contract_id: params.contractId,
        p_contract_type: params.contractType,
        p_company_id: params.companyId ?? null,
        p_user_id: params.userId ?? null,
        p_acceptance_source: params.audit.acceptanceSource,
        p_user_agent:
            typeof params.audit.metadata?.user_agent === 'string'
                ? params.audit.metadata.user_agent
                : typeof navigator !== 'undefined'
                  ? navigator.userAgent.slice(0, 2000)
                  : null,
        p_accepted_ip: params.audit.acceptedIp ?? null,
        p_scrolled_to_end: params.audit.scrolledToEnd ?? null,
        p_metadata: params.audit.metadata ?? {},
    });

    if (error) throw error;
    return data as {
        ok?: boolean;
        acceptance_id?: string;
        contract_id?: string;
        contract_version?: string;
        content_hash?: string;
        accepted_at?: string;
    };
}
