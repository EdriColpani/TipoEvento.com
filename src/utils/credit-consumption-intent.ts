import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { ensureWalletBiometricForSpend } from '@/utils/wallet-biometric';

export type ConsumptionIntentCreateResult = {
    ok: boolean;
    intent_id: string;
    gross_amount: number;
    biometric_threshold: number;
    biometric_required: boolean;
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
};

export async function markCreditConsumptionIntentBiometric(intentId: string): Promise<void> {
    await callRpcRest('mark_client_credit_consumption_intent_biometric', {
        p_intent_id: intentId,
    }, 12_000);
}

export async function createCreditConsumptionIntent(input: {
    menuToken: string;
    items: Array<{ productId: string; quantity: number }>;
}): Promise<ConsumptionIntentCreateResult> {
    return invokeEdgeFunctionRest<ConsumptionIntentCreateResult>(
        'create-credit-consumption-intent',
        { menuToken: input.menuToken, items: input.items },
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

export async function checkoutCreditConsumptionFromMenu(input: {
    userId: string;
    menuToken: string;
    items: Array<{ productId: string; quantity: number }>;
}): Promise<ConsumptionIntentCreateResult> {
    const created = await createCreditConsumptionIntent({
        menuToken: input.menuToken,
        items: input.items,
    });

    if (created.biometric_required) {
        await ensureWalletBiometricForSpend(
            input.userId,
            Number(created.gross_amount ?? 0),
            Number(created.biometric_threshold ?? 0),
        );
        await markCreditConsumptionIntentBiometric(created.intent_id);
    }

    return created;
}
