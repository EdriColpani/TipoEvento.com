import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

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

function emptyPayload(companyId: string): CreditEstablishmentsPayload {
    return {
        company_id: companyId,
        module_enabled: false,
        company_allows_credit: false,
        items: [],
    };
}

async function fetchEstablishments(companyId: string): Promise<CreditEstablishmentsPayload> {
    const fallback = emptyPayload(companyId);

    try {
        const data = await callRpcRest<CreditEstablishmentsPayload>(
            'list_company_credit_establishments',
            { p_company_id: companyId },
            10_000,
        );
        return {
            ...fallback,
            ...data,
            items: data?.items ?? [],
        };
    } catch (restError) {
        console.warn('[useCreditEstablishments] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('list_company_credit_establishments', { p_company_id: companyId }),
        10_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );

    if (error?.message && error.message !== 'timeout') {
        console.warn('[useCreditEstablishments]', error.message);
        return fallback;
    }

    const payload = data as CreditEstablishmentsPayload | null;
    if (!payload) return fallback;

    return {
        ...fallback,
        ...payload,
        items: payload.items ?? [],
    };
}

export function useCreditEstablishments(companyId: string | undefined) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['creditEstablishments', companyId],
        queryFn: () => withTimeout(fetchEstablishments(companyId!), 12_000, emptyPayload(companyId!)),
        enabled: !!companyId,
        staleTime: 30_000,
        retry: 1,
        placeholderData: companyId ? emptyPayload(companyId) : undefined,
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
    try {
        return await callRpcRest<{ ok: boolean; establishment_id: string }>(
            'save_credit_establishment',
            {
                p_company_id: input.companyId,
                p_name: input.name,
                p_event_id: input.eventId ?? null,
                p_establishment_id: input.establishmentId ?? null,
                p_credit_acceptance_enabled: input.creditAcceptanceEnabled ?? true,
                p_active: input.active ?? true,
            },
            15_000,
        );
    } catch (restError) {
        console.warn('[saveCreditEstablishment] REST falhou:', restError);
    }

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
    try {
        return await callRpcRest('set_credit_establishment_active', {
            p_establishment_id: establishmentId,
            p_company_id: companyId,
            p_active: active,
        }, 12_000);
    } catch (restError) {
        console.warn('[setCreditEstablishmentActive] REST falhou:', restError);
    }

    const { data, error } = await supabase.rpc('set_credit_establishment_active', {
        p_establishment_id: establishmentId,
        p_company_id: companyId,
        p_active: active,
    });
    if (error) throw error;
    return data;
}
