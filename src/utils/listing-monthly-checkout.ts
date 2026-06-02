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

    const payload = (data ?? {}) as {
        error?: string;
        alreadyPaid?: boolean;
        checkoutUrl?: string;
        chargeId?: string;
        amount?: number;
    };

    if (error) {
        const detail =
            payload?.error ||
            (error instanceof Error ? error.message : 'Erro ao iniciar pagamento.');
        throw new Error(detail);
    }

    if (body?.error) {
        throw new Error(body.error);
    }
    if (!body?.checkoutUrl || !body?.chargeId) {
        throw new Error('Resposta de pagamento inválida.');
    }

    return {
        checkoutUrl: body.checkoutUrl,
        chargeId: body.chargeId,
        amount: Number(body.amount ?? 0),
    };
}
