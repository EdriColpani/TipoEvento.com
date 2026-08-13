import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';

export type ContractAcceptanceOtpRequestResult = {
    ok: boolean;
    challenge_id?: string;
    destination_masked?: string;
    expires_at?: string;
    resend_cooldown_seconds?: number;
    error?: string;
    message?: string;
    retry_after_seconds?: number;
};

export type ContractAcceptanceOtpVerifyResult = {
    ok: boolean;
    challenge_id?: string;
    verified_at?: string;
    destination_masked?: string;
    contract_id?: string;
    contract_type?: string;
    company_id?: string | null;
    acceptance_source?: string;
    attempts_remaining?: number;
    error?: string;
    message?: string;
};

export type ContractAcceptanceFinalizeResult = {
    ok: boolean;
    idempotent?: boolean;
    acceptance_id?: string;
    contract_id?: string;
    contract_version?: string;
    document_hash?: string;
    accepted_at?: string;
    pdf_storage_path?: string | null;
    verification_method?: string;
    verification_channel?: string;
    billing_plan?: string | null;
    error?: string;
    message?: string;
};

export async function requestContractAcceptanceOtp(input: {
    contractId: string;
    contractType: string;
    companyId?: string | null;
    acceptanceSource: string;
}) {
    return invokeEdgeFunctionRest<ContractAcceptanceOtpRequestResult>(
        'contract-acceptance-request-otp',
        {
            contractId: input.contractId,
            contractType: input.contractType,
            companyId: input.companyId ?? null,
            acceptanceSource: input.acceptanceSource,
        },
        { timeoutMs: 30_000 },
    );
}

export async function verifyContractAcceptanceOtp(input: {
    challengeId: string;
    code: string;
}) {
    return invokeEdgeFunctionRest<ContractAcceptanceOtpVerifyResult>(
        'contract-acceptance-verify-otp',
        {
            challengeId: input.challengeId,
            code: input.code,
        },
        { timeoutMs: 20_000 },
    );
}

export async function finalizeContractAcceptance(input: {
    challengeId: string;
    contractId: string;
    contractType: string;
    companyId?: string | null;
    acceptanceSource: string;
    scrolledToEnd?: boolean;
    idempotencyKey: string;
    billingPlan?: string | null;
}) {
    return invokeEdgeFunctionRest<ContractAcceptanceFinalizeResult>(
        'contract-acceptance-finalize',
        {
            challengeId: input.challengeId,
            contractId: input.contractId,
            contractType: input.contractType,
            companyId: input.companyId ?? null,
            acceptanceSource: input.acceptanceSource,
            scrolledToEnd: input.scrolledToEnd ?? true,
            idempotencyKey: input.idempotencyKey,
            billingPlan: input.billingPlan ?? null,
        },
        { timeoutMs: 60_000, idempotencyKey: input.idempotencyKey },
    );
}
