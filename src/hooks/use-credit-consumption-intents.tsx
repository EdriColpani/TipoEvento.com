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
    client_label?: string | null;
    client_public_id?: string | null;
    establishment_id: string;
    establishment_name: string;
    event_id?: string | null;
    event_title?: string | null;
    status: CreditConsumptionIntentStatus;
    gross_amount: number;
    biometric_required: boolean;
    biometric_confirmed: boolean;
    spend_order_id: string | null;
    paid_at: string | null;
    delivered_at?: string | null;
    delivery_token: string | null;
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
    notes?: string | null;
}) {
    return callRpcRest<{ ok: boolean; status: string; refunded?: boolean }>(
        'update_manager_credit_consumption_intent_status',
        {
            p_company_id: input.companyId,
            p_intent_id: input.intentId,
            p_status: input.status,
            p_notes: input.notes ?? null,
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

export async function previewManagerCreditConsumptionDelivery(input: {
    companyId: string;
    deliveryToken: string;
}) {
    return callRpcRest<{
        ok: boolean;
        intent_id: string;
        status: string;
        gross_amount: number;
        paid_at: string | null;
        delivery_token_expires_at: string | null;
        client_label?: string | null;
        client_public_id?: string | null;
        establishment_name?: string | null;
        event_title?: string | null;
        can_confirm: boolean;
        block_reason?: string | null;
        items: Array<{
            product_id: string;
            product_name: string;
            quantity: number;
            unit_price: number;
            line_total: number;
            description?: string | null;
            image_url?: string | null;
            packaging_type?: string | null;
            units_per_box?: number | null;
        }>;
    }>(
        'preview_credit_consumption_delivery',
        {
            p_company_id: input.companyId,
            p_delivery_token: input.deliveryToken,
        },
        12_000,
    );
}

export async function completeManagerCreditConsumptionDelivery(input: {
    companyId: string;
    intentId?: string;
    deliveryToken?: string;
}) {
    return callRpcRest<{
        ok: boolean;
        duplicate?: boolean;
        intent_id: string;
        status: string;
        client_label?: string | null;
        client_public_id?: string | null;
        event_title?: string | null;
        items?: Array<{
            product_id: string;
            product_name: string;
            quantity: number;
            unit_price: number;
            line_total: number;
        }>;
    }>(
        'complete_credit_consumption_delivery',
        {
            p_company_id: input.companyId,
            p_intent_id: input.intentId ?? null,
            p_delivery_token: input.deliveryToken ?? null,
        },
        12_000,
    );
}
