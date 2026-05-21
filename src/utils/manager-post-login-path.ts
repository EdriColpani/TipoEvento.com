import { supabase } from '@/integrations/supabase/client';
import { isCompanyBillingReady, type CompanyBillingFields } from '@/constants/billing-plans';
import { MANAGER_BILLING_SETUP_PATH } from '@/constants/manager-billing-gate';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';

const BILLING_FIELDS =
    'billing_plan, billing_plan_accepted_at, billing_contract_id, requires_billing_reacceptance';

/** Destino após login do gestor PRO (dashboard ou aceite de contrato). */
export async function resolveManagerPostLoginPath(userId: string): Promise<string> {
    const companyId = await fetchManagerPrimaryCompanyId(supabase, userId);
    if (!companyId) {
        return '/manager/dashboard';
    }

    const { data, error } = await supabase
        .from('companies')
        .select(BILLING_FIELDS)
        .eq('id', companyId)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        console.warn('[resolveManagerPostLoginPath]', error.message);
        return '/manager/dashboard';
    }

    if (!isCompanyBillingReady(data as CompanyBillingFields | null)) {
        return MANAGER_BILLING_SETUP_PATH;
    }

    return '/manager/dashboard';
}
