import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';

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
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
        throw new Error('Faça login para recarregar créditos.');
    }

    const { data, error } = await supabase.functions.invoke('create-credit-checkout', {
        body: {
            amount,
            originCompanyId: options?.originCompanyId,
            originEventId: options?.originEventId,
            clientOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
        headers: { Authorization: `Bearer ${token}` },
    });

    if (error) {
        throw new Error(await parseEdgeFunctionError(error, data));
    }

    const payload = data as {
        checkoutUrl?: string;
        orderId?: string;
        grossPaidAmount?: number;
        creditGrantedAmount?: number;
        error?: string;
    };

    if (payload?.error) {
        throw new Error(payload.error);
    }
    if (!payload?.checkoutUrl || !payload?.orderId) {
        throw new Error('Resposta de pagamento inválida.');
    }

    return {
        checkoutUrl: payload.checkoutUrl,
        orderId: payload.orderId,
        grossPaidAmount: Number(payload.grossPaidAmount ?? amount),
        creditGrantedAmount: Number(payload.creditGrantedAmount ?? amount),
    };
}
