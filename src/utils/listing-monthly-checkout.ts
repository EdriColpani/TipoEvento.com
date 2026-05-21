import { supabase } from '@/integrations/supabase/client';

export interface ListingCheckoutResult {
    checkoutUrl: string;
    chargeId: string;
    amount: number;
}

export async function startListingMonthlyCheckout(
    companyId: string,
    chargeId?: string,
): Promise<ListingCheckoutResult> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
        throw new Error('Sessão expirada. Entre novamente no gestor.');
    }

    const { data, error } = await supabase.functions.invoke('create-listing-monthly-checkout', {
        body: {
            companyId,
            chargeId,
            clientOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
        headers: { Authorization: `Bearer ${token}` },
    });

    if (error) {
        throw new Error(error.message || 'Erro ao iniciar pagamento.');
    }

    const payload = data as {
        checkoutUrl?: string;
        chargeId?: string;
        amount?: number;
        error?: string;
        alreadyPaid?: boolean;
    };

    if (payload?.error) {
        throw new Error(payload.error);
    }
    if (!payload?.checkoutUrl || !payload?.chargeId) {
        throw new Error('Resposta de pagamento inválida.');
    }

    return {
        checkoutUrl: payload.checkoutUrl,
        chargeId: payload.chargeId,
        amount: Number(payload.amount ?? 0),
    };
}
