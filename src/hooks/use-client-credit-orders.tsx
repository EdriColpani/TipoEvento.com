import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type ClientCreditOrderItem = {
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

export type ClientCreditOrder = {
    id: string;
    status: string;
    gross_amount: number;
    paid_at: string | null;
    delivered_at: string | null;
    delivery_token: string | null;
    delivery_token_expires_at: string | null;
    created_at: string;
    updated_at: string;
    establishment_id: string;
    establishment_name: string;
    event_id: string | null;
    event_title: string | null;
    items: ClientCreditOrderItem[];
};

export async function fetchClientCreditOrders(): Promise<ClientCreditOrder[]> {
    const data = await callRpcRest<{ ok?: boolean; items?: ClientCreditOrder[] }>(
        'list_client_credit_consumption_orders',
        { p_limit: 40, p_offset: 0 },
        12_000,
    );
    return data?.items ?? [];
}

export function useClientCreditOrders(enabled = true) {
    return useQuery({
        queryKey: ['clientCreditOrders'],
        queryFn: fetchClientCreditOrders,
        enabled,
        staleTime: 10_000,
        refetchInterval: (query) => {
            const items = query.state.data ?? [];
            const hasOpen = items.some(
                (o) => o.status !== 'completed' && o.status !== 'cancelled',
            );
            return hasOpen ? 10_000 : 30_000;
        },
    });
}

export function isDeliveryQrActive(order: ClientCreditOrder): boolean {
    if (!order.delivery_token) return false;
    if (order.status === 'completed' || order.status === 'cancelled') return false;
    if (!order.delivery_token_expires_at) return true;
    return new Date(order.delivery_token_expires_at).getTime() > Date.now();
}
