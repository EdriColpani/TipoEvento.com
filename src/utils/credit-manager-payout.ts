import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';

export interface RetryCreditDisbursementResult {
    retried: number;
    succeeded: number;
    results: Array<{ spendOrderId: string; ok: boolean; mpTransferId?: string; error?: string }>;
}

export async function retryFailedCreditDisbursements(
    companyId: string,
    spendOrderId?: string,
): Promise<RetryCreditDisbursementResult> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error('Faça login para reprocessar repasses.');

    const { data, error } = await supabase.functions.invoke('manager-credit-payout', {
        body: {
            companyId,
            spendOrderId,
        },
        headers: { Authorization: `Bearer ${token}` },
    });

    if (error) {
        throw new Error(await parseEdgeFunctionError(error, data));
    }

    const payload = data as {
        ok?: boolean;
        retried?: number;
        succeeded?: number;
        results?: RetryCreditDisbursementResult['results'];
        error?: string;
    };

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
    const { data, error } = await supabase.rpc('credit_refund_to_wallet', {
        p_client_user_id: clientUserId,
        p_amount: amount,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
    });
    if (error) throw error;
    const payload = data as {
        ok?: boolean;
        refund_case_id?: string;
        balance?: number;
        error?: string;
    };
    if (!payload?.ok) throw new Error('Estorno não concluído.');
    return {
        refundCaseId: payload.refund_case_id!,
        balance: Number(payload.balance ?? 0),
    };
}
