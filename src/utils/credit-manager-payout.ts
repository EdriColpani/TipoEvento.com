import { callRpcRest } from '@/utils/supabase-rest-rpc';

export interface RegisterManualSettlementResult {
    batchId: string;
    totalAmount: number;
    settlementCount: number;
    paymentReference: string;
    paymentMethod: string;
}

export async function registerAdminCreditSettlementPayment(
    companyId: string,
    options?: {
        settlementIds?: string[];
        paymentMethod?: 'pix' | 'ted' | 'mp_transfer' | 'other';
        paymentReference?: string;
        notes?: string;
    },
): Promise<RegisterManualSettlementResult> {
    const payload = await callRpcRest<{
        ok?: boolean;
        batch_id?: string;
        total_amount?: number;
        settlement_count?: number;
        payment_reference?: string;
        payment_method?: string;
        error?: string;
    }>(
        'register_admin_credit_settlement_payment',
        {
            p_company_id: companyId,
            p_settlement_ids: options?.settlementIds?.length ? options.settlementIds : null,
            p_payment_method: options?.paymentMethod ?? 'pix',
            p_payment_reference: options?.paymentReference ?? null,
            p_notes: options?.notes ?? null,
        },
        25_000,
    );

    if (!payload?.ok) throw new Error('Não foi possível registrar o pagamento.');

    return {
        batchId: payload.batch_id!,
        totalAmount: Number(payload.total_amount ?? 0),
        settlementCount: Number(payload.settlement_count ?? 0),
        paymentReference: payload.payment_reference ?? '',
        paymentMethod: payload.payment_method ?? 'pix',
    };
}

/** @deprecated Repasse MP automático descontinuado. */
export async function retryFailedCreditDisbursements(): Promise<never> {
    throw new Error('Repasse automático Mercado Pago foi descontinuado. Use liquidação manual (TED/PIX).');
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
