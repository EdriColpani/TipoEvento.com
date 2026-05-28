import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
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
    const { error } = await supabase.rpc('mark_client_credit_consumption_intent_biometric', {
        p_intent_id: intentId,
    });
    if (error) throw error;
}

export async function createCreditConsumptionIntent(input: {
    menuToken: string;
    items: Array<{ productId: string; quantity: number }>;
}): Promise<ConsumptionIntentCreateResult> {
    const { data, error } = await supabase.functions.invoke('create-credit-consumption-intent', {
        body: {
            menuToken: input.menuToken,
            items: input.items,
        },
    });
    if (error) throw new Error(await parseEdgeFunctionError(error, data));
    return data as ConsumptionIntentCreateResult;
}

export async function confirmCreditConsumptionIntent(input: {
    intentId: string;
    idempotencyKey?: string;
    biometricConfirmed?: boolean;
}): Promise<ConsumptionIntentConfirmResult> {
    const key = input.idempotencyKey ?? crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke('confirm-credit-consumption-intent', {
        body: {
            intentId: input.intentId,
            idempotencyKey: key,
            biometricConfirmed: input.biometricConfirmed === true,
        },
        headers: {
            'x-idempotency-key': key,
        },
    });
    if (error) throw new Error(await parseEdgeFunctionError(error, data));
    return data as ConsumptionIntentConfirmResult;
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
