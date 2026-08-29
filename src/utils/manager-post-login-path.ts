import { supabase } from '@/integrations/supabase/client';
import { isCompanyBillingReady, type CompanyBillingFields } from '@/constants/billing-plans';
import { MANAGER_BILLING_SETUP_PATH } from '@/constants/manager-billing-gate';
import {
    isCompanyRegistrationSatisfied,
    MANAGER_COMPANY_REGISTRATION_PATH,
} from '@/constants/manager-onboarding-gate';
import { fetchManagerPrimaryCompanyId, fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';

const BILLING_FIELDS =
    'billing_plan, billing_plan_accepted_at, billing_contract_id, requires_billing_reacceptance';

async function fetchCompanyBilling(companyId: string): Promise<CompanyBillingFields | null> {
    const billingFields =
        'billing_plan,billing_plan_accepted_at,billing_contract_id,requires_billing_reacceptance';

    try {
        const rows = await restGet<CompanyBillingFields[]>(
            `companies?id=eq.${companyId}&select=${billingFields}&limit=1`,
            6_000,
        );
        return rows[0] ?? null;
    } catch {
        /* fallback supabase */
    }

    const { data, error } = await withTimeout(
        supabase.from('companies').select(BILLING_FIELDS).eq('id', companyId).maybeSingle(),
        6_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );

    if (error && error.code !== 'PGRST116') {
        console.warn('[resolveManagerPostLoginPath]', error.message);
        return null;
    }

    return (data as CompanyBillingFields | null) ?? null;
}

async function registrationGateSatisfied(
    companyId: string,
    billing: CompanyBillingFields | null,
): Promise<boolean> {
    try {
        const signed = await callRpcRest<boolean>(
            'company_registration_gate_satisfied',
            { p_company_id: companyId },
            6_000,
        );
        if (typeof signed === 'boolean') return signed;
    } catch {
        /* fallback: só o legado de plano antigo */
    }
    return isCompanyRegistrationSatisfied(false, billing);
}

function pathAfterOnboarding(billing: CompanyBillingFields | null): string {
    if (!isCompanyBillingReady(billing)) {
        return MANAGER_BILLING_SETUP_PATH;
    }
    return '/manager/dashboard';
}

/** Destino após login do gestor PRO (contrato de cadastro → plano → dashboard). */
export async function resolveManagerPostLoginPath(userId: string): Promise<string> {
    let companyId: string | null = null;
    try {
        companyId = await fetchManagerPrimaryCompanyIdRest(userId);
    } catch {
        /* fallback abaixo */
    }
    if (!companyId) {
        companyId = await withTimeout(fetchManagerPrimaryCompanyId(supabase, userId), 6_000, null);
    }
    if (!companyId) {
        return '/manager/dashboard';
    }

    // Operador PDV: vai direto ao PDV (sem gate de plano/cadastro do owner).
    try {
        const roleRows = await restGet<{ role: string }[]>(
            `user_companies?user_id=eq.${encodeURIComponent(userId)}&company_id=eq.${encodeURIComponent(companyId)}&select=role&limit=1`,
            4_000,
        );
        if (roleRows?.[0]?.role === 'pdv_operator') {
            return '/manager/credit/pdv';
        }
    } catch {
        /* segue fluxo normal */
    }

    const billing = await fetchCompanyBilling(companyId);
    if (!(await registrationGateSatisfied(companyId, billing))) {
        return MANAGER_COMPANY_REGISTRATION_PATH;
    }

    if (!billing) {
        return '/manager/dashboard';
    }

    return pathAfterOnboarding(billing);
}
