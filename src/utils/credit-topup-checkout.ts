import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';

export interface CreditTopupCheckoutResult {
    checkoutUrl: string;
    orderId: string;
    grossPaidAmount: number;
    creditGrantedAmount: number;
}

export async function startCreditTopupCheckout(
    amount: number,
    options?: { originCompanyId?: string; originEventId?: string },
): Promise<CreditTopupCheckoutResult> {
    const token = getAuthAccessToken();
    if (!token) {
        throw new Error('Faça login para recarregar créditos.');
    }

    // fetch + timeout: evita deadlock do supabase.functions.invoke / getSession
    const payload = await invokeEdgeFunctionRest<{
        checkoutUrl?: string;
        orderId?: string;
        grossPaidAmount?: number;
        creditGrantedAmount?: number;
        error?: string;
    }>(
        'create-credit-checkout',
        {
            amount,
            originCompanyId: options?.originCompanyId,
            originEventId: options?.originEventId,
            clientOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
        { timeoutMs: 45_000 },
    );

    if (!payload) {
        throw new Error('Resposta vazia do servidor de recarga.');
    }
    if (payload.error) {
        throw new Error(payload.error);
    }
    if (!payload.checkoutUrl || !payload.orderId) {
        throw new Error('Resposta de pagamento inválida.');
    }

    return {
        checkoutUrl: payload.checkoutUrl,
        orderId: payload.orderId,
        grossPaidAmount: Number(payload.grossPaidAmount ?? amount),
        creditGrantedAmount: Number(payload.creditGrantedAmount ?? amount),
    };
}
