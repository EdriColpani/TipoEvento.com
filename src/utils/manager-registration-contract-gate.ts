import { fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { restGet } from '@/utils/supabase-rest';
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

/**
 * Fallback quando a RPC do gate falha: se a empresa já tem plano aceito,
 * o onboarding está concluído (trigger impede plano sem contrato de cadastro).
 */
async function fallbackRegistrationSatisfied(companyId: string): Promise<boolean> {
    try {
        const rows = await restGet<
            {
                billing_plan_accepted_at?: string | null;
            }[]
        >(
            `companies?id=eq.${encodeURIComponent(companyId)}&select=billing_plan_accepted_at&limit=1`,
            6_000,
        );
        if (rows[0]?.billing_plan_accepted_at) return true;
    } catch {
        /* continue */
    }

    try {
        const acceptances = await restGet<{ contract_type?: string; acceptance_source?: string }[]>(
            `contract_acceptances?company_id=eq.${encodeURIComponent(companyId)}&select=contract_type,acceptance_source&limit=50`,
            6_000,
        );
        return Boolean(
            acceptances?.some(
                (row) =>
                    row.contract_type === 'company_registration' ||
                    row.acceptance_source === 'manager_register',
            ),
        );
    } catch {
        return false;
    }
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
        // Não assumir "pendente" em falha de rede — evita loop em gestores já cadastrados.
        registrationSatisfied = await fallbackRegistrationSatisfied(companyId);
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
