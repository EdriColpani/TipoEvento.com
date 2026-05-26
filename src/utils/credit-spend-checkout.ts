import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
import {
    detectCreditSpendChannel,
    ensureWalletBiometricForSpend,
    isStandalonePwa,
} from '@/utils/wallet-biometric';

export interface CreditSpendPurchaseItem {
    ticketTypeId: string;
    quantity: number;
    price: number;
    name: string;
}

export interface CreditSpendCheckoutResult {
    spendOrderId: string;
    balance: number;
    grossAmount: number;
    platformAmount?: number;
    managerAmount?: number;
    mpTransferId?: string;
    duplicate: boolean;
    publicDescription?: string;
}

export type CreditSpendCheckoutOptions = {
    idempotencyKey?: string;
    biometricThreshold?: number;
    skipBiometric?: boolean;
    channel?: 'web' | 'app';
};

export async function startCreditSpendCheckout(
    eventId: string,
    purchaseItems: CreditSpendPurchaseItem[],
    options?: CreditSpendCheckoutOptions,
): Promise<CreditSpendCheckoutResult> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const user = sess.session?.user;
    if (!token || !user) {
        throw new Error('Faça login para pagar com crédito EventFest.');
    }

    const key = options?.idempotencyKey ?? crypto.randomUUID();
    const gross = purchaseItems.reduce(
        (sum, item) => sum + Number(item.price) * Number(item.quantity),
        0,
    );

    const threshold = Number(options?.biometricThreshold ?? 0);
    if (!options?.skipBiometric && threshold > 0) {
        await ensureWalletBiometricForSpend(user.id, gross, threshold);
    }

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const channel = options?.channel ?? detectCreditSpendChannel(isMobile);

    const { data, error } = await supabase.functions.invoke('credit-spend', {
        body: {
            eventId,
            purchaseItems,
            idempotencyKey: key,
            channel,
        },
        headers: {
            Authorization: `Bearer ${token}`,
            'x-idempotency-key': key,
        },
    });

    if (error) {
        throw new Error(await parseEdgeFunctionError(error, data));
    }

    const payload = data as {
        ok?: boolean;
        spendOrderId?: string;
        balance?: number;
        grossAmount?: number;
        platformAmount?: number;
        managerAmount?: number;
        mpTransferId?: string;
        duplicate?: boolean;
        publicDescription?: string;
        error?: string;
    };

    if (payload?.error) {
        throw new Error(payload.error);
    }
    if (!payload?.ok || !payload?.spendOrderId) {
        throw new Error('Resposta de pagamento com crédito inválida.');
    }

    return {
        spendOrderId: payload.spendOrderId,
        balance: Number(payload.balance ?? 0),
        grossAmount: Number(payload.grossAmount ?? gross),
        platformAmount: payload.platformAmount != null ? Number(payload.platformAmount) : undefined,
        managerAmount: payload.managerAmount != null ? Number(payload.managerAmount) : undefined,
        mpTransferId: payload.mpTransferId,
        duplicate: payload.duplicate === true,
        publicDescription: payload.publicDescription,
    };
}

export type EventCreditEligibility = {
    eligible: boolean;
    module_enabled?: boolean;
    event_credit_enabled?: boolean;
    reason?: string | null;
};

export async function fetchEventCreditEligibility(eventId: string): Promise<EventCreditEligibility> {
    const { data, error } = await supabase.rpc('get_event_credit_payment_eligibility', {
        p_event_id: eventId,
    });
    if (error) throw error;
    return (data ?? { eligible: false }) as EventCreditEligibility;
}

export { isStandalonePwa, detectCreditSpendChannel };
