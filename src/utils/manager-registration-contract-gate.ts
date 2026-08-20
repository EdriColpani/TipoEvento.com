import { fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { MANAGER_COMPANY_REGISTRATION_PATH } from '@/constants/manager-onboarding-gate';

export type ManagerRegistrationGateStatus = {
    companyId: string | null;
    registrationSatisfied: boolean;
    /** Empresa já criada, mas contrato de cadastro ainda não assinado. */
    pendingContractSigning: boolean;
};

/** Única rota permitida enquanto o contrato de cadastro estiver pendente. */
export const MANAGER_REGISTRATION_CONTRACT_PATH = MANAGER_COMPANY_REGISTRATION_PATH;

export function isManagerRegistrationContractPath(pathname: string): boolean {
    return pathname === MANAGER_REGISTRATION_CONTRACT_PATH;
}

export function isManagerRegistrationSubFlowPath(pathname: string): boolean {
    return pathname.startsWith('/manager/register/');
}

export async function fetchManagerRegistrationGateStatus(
    userId: string,
): Promise<ManagerRegistrationGateStatus> {
    let companyId: string | null = null;
    try {
        companyId = await fetchManagerPrimaryCompanyIdRest(userId);
    } catch {
        companyId = null;
    }

    if (!companyId) {
        return {
            companyId: null,
            registrationSatisfied: true,
            pendingContractSigning: false,
        };
    }

    let registrationSatisfied = false;
    try {
        const satisfied = await callRpcRest<boolean>(
            'company_registration_gate_satisfied',
            { p_company_id: companyId },
            8_000,
        );
        registrationSatisfied = satisfied === true;
    } catch {
        registrationSatisfied = false;
    }

    return {
        companyId,
        registrationSatisfied,
        pendingContractSigning: !registrationSatisfied,
    };
}

export function shouldForceManagerRegistrationContract(
    status: ManagerRegistrationGateStatus | null | undefined,
): boolean {
    return Boolean(status?.pendingContractSigning);
}

/** Onde redirecionar quando a empresa existe mas falta assinar o contrato. */
export function managerRegistrationContractRedirectPath(
    status: ManagerRegistrationGateStatus | null | undefined,
): string | null {
    if (!shouldForceManagerRegistrationContract(status)) return null;
    return MANAGER_REGISTRATION_CONTRACT_PATH;
}
