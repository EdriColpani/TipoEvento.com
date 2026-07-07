import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';
import { generateRandomUuid } from '@/utils/random-id';

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
        refetchInterval: (query) => (query.state.error ? false : 15_000),
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
    return callRpcRest<{ ok: boolean; status: string }>(
        'update_manager_credit_consumption_intent_status',
        {
            p_company_id: input.companyId,
            p_intent_id: input.intentId,
            p_status: input.status,
        },
        12_000,
    );
}

export async function confirmManagerCreditConsumptionIntent(input: {
    intentId: string;
    idempotencyKey?: string;
}) {
    const key = input.idempotencyKey ?? generateRandomUuid();
    return invokeEdgeFunctionRest<{
        ok: boolean;
        spendOrderId: string;
        duplicate: boolean;
        grossAmount: number;
    }>(
        'confirm-credit-consumption-intent-manager',
        { intentId: input.intentId, idempotencyKey: key },
        { idempotencyKey: key, timeoutMs: 25_000 },
    );
}
