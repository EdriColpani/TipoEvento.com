import { supabase } from '@/integrations/supabase/client';
import { isCompanyBillingReady, type CompanyBillingFields } from '@/constants/billing-plans';
import { MANAGER_BILLING_SETUP_PATH } from '@/constants/manager-billing-gate';
import { fetchManagerPrimaryCompanyId, fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';

const BILLING_FIELDS =
    'billing_plan, billing_plan_accepted_at, billing_contract_id, requires_billing_reacceptance';

/** Destino após login do gestor PRO (dashboard ou aceite de contrato). */
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

    const billingFields =
        'billing_plan,billing_plan_accepted_at,billing_contract_id,requires_billing_reacceptance';

    try {
        const rows = await restGet<CompanyBillingFields[]>(
            `companies?id=eq.${companyId}&select=${billingFields}&limit=1`,
            6_000,
        );
        if (!isCompanyBillingReady(rows[0] ?? null)) {
            return MANAGER_BILLING_SETUP_PATH;
        }
        return '/manager/dashboard';
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
        return '/manager/dashboard';
    }

    if (!isCompanyBillingReady(data as CompanyBillingFields | null)) {
        return MANAGER_BILLING_SETUP_PATH;
    }

    return '/manager/dashboard';
}
