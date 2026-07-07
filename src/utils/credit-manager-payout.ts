import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export interface RetryCreditDisbursementResult {
    retried: number;
    succeeded: number;
    results: Array<{ spendOrderId: string; ok: boolean; mpTransferId?: string; error?: string }>;
}

export async function retryFailedCreditDisbursements(
    companyId: string,
    spendOrderId?: string,
): Promise<RetryCreditDisbursementResult> {
    const payload = await invokeEdgeFunctionRest<{
        ok?: boolean;
        retried?: number;
        succeeded?: number;
        results?: RetryCreditDisbursementResult['results'];
        error?: string;
    }>(
        'manager-credit-payout',
        { companyId, spendOrderId },
        { timeoutMs: 30_000 },
    );

    if (payload?.error) throw new Error(payload.error);

    return {
        retried: Number(payload.retried ?? 0),
        succeeded: Number(payload.succeeded ?? 0),
        results: payload.results ?? [],
    };
}

export async function adminCreditRefund(
    clientUserId: string,
    amount: number | null,
    reason: string,
): Promise<{ refundCaseId: string; balance: number }> {
    const payload = await callRpcRest<{
        ok?: boolean;
        refund_case_id?: string;
        balance?: number;
        error?: string;
    }>(
        'credit_refund_to_wallet',
        {
            p_client_user_id: clientUserId,
            p_amount: amount,
            p_reason: reason,
            p_idempotency_key: crypto.randomUUID(),
        },
        20_000,
    );
    if (!payload?.ok) throw new Error('Estorno não concluído.');
    return {
        refundCaseId: payload.refund_case_id!,
        balance: Number(payload.balance ?? 0),
    };
}
