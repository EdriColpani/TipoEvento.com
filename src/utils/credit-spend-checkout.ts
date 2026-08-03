import { getAuthAccessToken, readCachedAuthSession } from '@/utils/auth-session-cache';
import { callRpcPublicRest } from '@/utils/supabase-rest-rpc';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
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
    const token = getAuthAccessToken();
    const { userId } = readCachedAuthSession();
    if (!token || !userId) {
        throw new Error('Faça login para pagar com crédito EventFest.');
    }

    const key = options?.idempotencyKey ?? crypto.randomUUID();
    const gross = purchaseItems.reduce(
        (sum, item) => sum + Number(item.price) * Number(item.quantity),
        0,
    );

    const threshold = Number(options?.biometricThreshold ?? 0);
    if (!options?.skipBiometric && threshold > 0) {
        await ensureWalletBiometricForSpend(userId, gross, threshold);
    }

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const channel = options?.channel ?? detectCreditSpendChannel(isMobile);

    // fetch + timeout: supabase.functions.invoke pode ficar pendurado no getSession
    // e a UI nunca sai de "Processando...".
    const payload = await invokeEdgeFunctionRest<{
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
    }>(
        'credit-spend',
        {
            eventId,
            purchaseItems,
            idempotencyKey: key,
            channel,
        },
        {
            timeoutMs: 45_000,
            idempotencyKey: key,
        },
    );

    if (!payload) {
        throw new Error('Resposta vazia do pagamento com crédito.');
    }

    if (payload.error) {
        throw new Error(payload.error);
    }
    if (!payload.ok || !payload.spendOrderId) {
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
    const data = await callRpcPublicRest<EventCreditEligibility>(
        'get_event_credit_payment_eligibility',
        { p_event_id: eventId },
        10_000,
    );
    return data ?? { eligible: false };
}

export { isStandalonePwa, detectCreditSpendChannel };
