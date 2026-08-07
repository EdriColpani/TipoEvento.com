import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { ensureWalletBiometricForSpend } from '@/utils/wallet-biometric';

export type ConsumptionIntentCreateResult = {
    ok: boolean;
    intent_id: string;
    gross_amount: number;
    biometric_threshold: number;
    biometric_required: boolean;
    event_id?: string | null;
};

export type ConsumptionIntentConfirmResult = {
    ok: boolean;
    spendOrderId: string;
    balance: number;
    grossAmount: number;
    platformAmount?: number;
    managerAmount?: number;
    mpTransferId?: string;
    duplicate: boolean;
    publicDescription?: string;
    deliveryToken?: string | null;
    status?: string;
};

export async function markCreditConsumptionIntentBiometric(intentId: string): Promise<void> {
    await callRpcRest('mark_client_credit_consumption_intent_biometric', {
        p_intent_id: intentId,
    }, 12_000);
}

export async function createCreditConsumptionIntent(input: {
    menuToken?: string;
    establishmentId?: string;
    eventId?: string;
    items: Array<{ productId: string; quantity: number }>;
}): Promise<ConsumptionIntentCreateResult> {
    if (!input.menuToken && !input.establishmentId) {
        throw new Error('Informe o estabelecimento ou o QR do balcão.');
    }
    return invokeEdgeFunctionRest<ConsumptionIntentCreateResult>(
        'create-credit-consumption-intent',
        {
            menuToken: input.menuToken,
            establishmentId: input.establishmentId,
            eventId: input.eventId,
            items: input.items,
        },
        { timeoutMs: 25_000 },
    );
}

export async function confirmCreditConsumptionIntent(input: {
    intentId: string;
    idempotencyKey?: string;
    biometricConfirmed?: boolean;
}): Promise<ConsumptionIntentConfirmResult> {
    const key = input.idempotencyKey ?? crypto.randomUUID();
    return invokeEdgeFunctionRest<ConsumptionIntentConfirmResult>(
        'confirm-credit-consumption-intent',
        {
            intentId: input.intentId,
            idempotencyKey: key,
            biometricConfirmed: input.biometricConfirmed === true,
        },
        { idempotencyKey: key, timeoutMs: 25_000 },
    );
}

/** Cria o pedido, debita crédito e retorna token de entrega (QR). */
export async function checkoutCreditConsumption(input: {
    userId: string;
    menuToken?: string;
    establishmentId?: string;
    eventId?: string;
    items: Array<{ productId: string; quantity: number }>;
}): Promise<ConsumptionIntentConfirmResult & { intentId: string }> {
    const created = await createCreditConsumptionIntent({
        menuToken: input.menuToken,
        establishmentId: input.establishmentId,
        eventId: input.eventId,
        items: input.items,
    });

    let biometricConfirmed = false;
    if (created.biometric_required) {
        await ensureWalletBiometricForSpend(
            input.userId,
            Number(created.gross_amount ?? 0),
            Number(created.biometric_threshold ?? 0),
        );
        await markCreditConsumptionIntentBiometric(created.intent_id);
        biometricConfirmed = true;
    }

    const confirmed = await confirmCreditConsumptionIntent({
        intentId: created.intent_id,
        biometricConfirmed,
    });

    return {
        ...confirmed,
        intentId: created.intent_id,
    };
}

/** @deprecated Prefer checkoutCreditConsumption (débito na compra). */
export async function checkoutCreditConsumptionFromMenu(input: {
    userId: string;
    menuToken: string;
    items: Array<{ productId: string; quantity: number }>;
}): Promise<ConsumptionIntentConfirmResult & { intentId: string; gross_amount?: number }> {
    const result = await checkoutCreditConsumption({
        userId: input.userId,
        menuToken: input.menuToken,
        items: input.items,
    });
    return {
        ...result,
        gross_amount: result.grossAmount,
    };
}
