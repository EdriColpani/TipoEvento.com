import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CreditEstablishment = {
    id: string;
    company_id: string;
    event_id: string | null;
    name: string;
    credit_acceptance_enabled: boolean;
    active: boolean;
    created_at: string;
    event_title?: string | null;
};

export type CreditEstablishmentsPayload = {
    company_id: string;
    module_enabled: boolean;
    company_allows_credit: boolean;
    items: CreditEstablishment[];
};

async function fetchEstablishments(companyId: string): Promise<CreditEstablishmentsPayload> {
    const { data, error } = await supabase.rpc('list_company_credit_establishments', {
        p_company_id: companyId,
    });
    if (error) throw error;
    const payload = data as CreditEstablishmentsPayload;
    return {
        ...payload,
        items: payload?.items ?? [],
    };
}

export function useCreditEstablishments(companyId: string | undefined) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['creditEstablishments', companyId],
        queryFn: () => fetchEstablishments(companyId!),
        enabled: !!companyId,
        staleTime: 30_000,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['creditEstablishments', companyId] });
    };

    return { ...query, invalidate };
}

export async function saveCreditEstablishment(input: {
    companyId: string;
    name: string;
    eventId?: string | null;
    establishmentId?: string | null;
    creditAcceptanceEnabled?: boolean;
    active?: boolean;
}) {
    const { data, error } = await supabase.rpc('save_credit_establishment', {
        p_company_id: input.companyId,
        p_name: input.name,
        p_event_id: input.eventId ?? null,
        p_establishment_id: input.establishmentId ?? null,
        p_credit_acceptance_enabled: input.creditAcceptanceEnabled ?? true,
        p_active: input.active ?? true,
    });
    if (error) throw error;
    return data as { ok: boolean; establishment_id: string };
}

export async function setCreditEstablishmentActive(
    establishmentId: string,
    companyId: string,
    active: boolean,
) {
    const { data, error } = await supabase.rpc('set_credit_establishment_active', {
        p_establishment_id: establishmentId,
        p_company_id: companyId,
        p_active: active,
    });
    if (error) throw error;
    return data;
}
