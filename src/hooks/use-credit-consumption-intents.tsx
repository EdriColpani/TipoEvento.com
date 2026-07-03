import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

export type CreditConsumptionIntentStatus =
    | 'new'
    | 'in_preparation'
    | 'ready_for_pickup'
    | 'completed'
    | 'cancelled'
    | 'expired';

export type ManagerCreditConsumptionIntent = {
    id: string;
    client_user_id: string;
    establishment_id: string;
    establishment_name: string;
    status: CreditConsumptionIntentStatus;
    gross_amount: number;
    biometric_required: boolean;
    biometric_confirmed: boolean;
    spend_order_id: string | null;
    created_at: string;
    updated_at: string;
    status_history: Array<{
        id: string;
        from_status: string | null;
        to_status: string;
        source: string;
        notes: string | null;
        created_at: string;
        changed_by_user_id: string | null;
        changed_by_label: string;
    }>;
    items: Array<{
        product_id: string;
        product_name: string;
        quantity: number;
        unit_price: number;
        line_total: number;
    }>;
};

type IntentsPayload = {
    company_id: string;
    items: ManagerCreditConsumptionIntent[];
};

async function fetchManagerIntents(
    companyId: string,
    status?: CreditConsumptionIntentStatus | 'all',
): Promise<IntentsPayload> {
    const statusParam = status && status !== 'all' ? status : null;
    const fallback: IntentsPayload = { company_id: companyId, items: [] };

    try {
        const data = await callRpcRest<IntentsPayload>(
            'list_manager_credit_consumption_intents',
            {
                p_company_id: companyId,
                p_status: statusParam,
                p_limit: 80,
                p_offset: 0,
            },
            10_000,
        );
        return { ...fallback, ...data, items: data?.items ?? [] };
    } catch (restError) {
        console.warn('[useManagerCreditConsumptionIntents] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('list_manager_credit_consumption_intents', {
            p_company_id: companyId,
            p_status: statusParam,
            p_limit: 80,
            p_offset: 0,
        }),
        10_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );

    if (error?.message && error.message !== 'timeout') throw error;
    const payload = (data ?? {}) as IntentsPayload;
    return { ...fallback, ...payload, items: payload?.items ?? [] };
}

export function useManagerCreditConsumptionIntents(
    companyId: string | undefined,
    status?: CreditConsumptionIntentStatus | 'all',
) {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['managerCreditConsumptionIntents', companyId, status ?? 'all'],
        queryFn: () => withTimeout(fetchManagerIntents(companyId!, status), 12_000, { company_id: companyId!, items: [] }),
        enabled: !!companyId,
        staleTime: 10_000,
        retry: 1,
        refetchInterval: 15_000,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['managerCreditConsumptionIntents', companyId] });
    };

    return { ...query, invalidate };
}

export async function updateManagerCreditConsumptionIntentStatus(input: {
    companyId: string;
    intentId: string;
    status: Exclude<CreditConsumptionIntentStatus, 'completed' | 'expired'>;
}) {
    const { data, error } = await supabase.rpc('update_manager_credit_consumption_intent_status', {
        p_company_id: input.companyId,
        p_intent_id: input.intentId,
        p_status: input.status,
    });
    if (error) throw error;
    return data as { ok: boolean; status: string };
}

export async function confirmManagerCreditConsumptionIntent(input: {
    intentId: string;
    idempotencyKey?: string;
}) {
    const key = input.idempotencyKey ?? crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke('confirm-credit-consumption-intent-manager', {
        body: { intentId: input.intentId, idempotencyKey: key },
        headers: { 'x-idempotency-key': key },
    });
    if (error) {
        throw new Error(await parseEdgeFunctionError(error, data));
    }
    return data as {
        ok: boolean;
        spendOrderId: string;
        duplicate: boolean;
        grossAmount: number;
    };
}
