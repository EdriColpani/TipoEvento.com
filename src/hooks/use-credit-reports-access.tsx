import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isCompanyBillingReady } from '@/constants/billing-plans';
import { managerCanViewCreditReports } from '@/utils/company-billing-rules';
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyBilling } from '@/hooks/use-company-billing';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const MANAGER_PRO_USER_TYPE_ID = 2;

async function fetchCreditModuleGloballyEnabled(): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_credit_wallet_status');
    if (error) throw error;
    return (data as { module_enabled?: boolean })?.module_enabled === true;
}

/**
 * Gestor: plano consumo/híbrido OU módulo global ligado no admin + empresa vinculada.
 * Admin master: sempre acesso à visão rede completa (sem exigir empresa).
 */
export function useCreditReportsAccess(userId: string | undefined) {
    const { profile, isLoading: profileLoading } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const isManagerPro = profile?.tipo_usuario_id === MANAGER_PRO_USER_TYPE_ID;

    const { company, isLoading: companyLoading } = useManagerCompany(
        isManagerPro && !isAdminMaster ? userId : undefined,
    );
    const { billing, isLoading: billingLoading } = useCompanyBilling(company?.id);

    const moduleQuery = useQuery({
        queryKey: ['creditModuleGloballyEnabled'],
        queryFn: fetchCreditModuleGloballyEnabled,
        staleTime: 60_000,
    });

    const billingReady = isCompanyBillingReady(billing);
    const globalModuleOn = moduleQuery.data === true;
    const planAllowsCredit = managerCanViewCreditReports(billing?.billing_plan, globalModuleOn);

    const canAccessManagerCreditReports =
        isManagerPro &&
        !isAdminMaster &&
        !!company?.id &&
        billingReady &&
        planAllowsCredit;

    const canAccessAdminCreditReports = isAdminMaster;

    const showCreditReportCards = canAccessManagerCreditReports || canAccessAdminCreditReports;

    return {
        isAdminMaster,
        isManagerPro,
        company,
        billing,
        billingReady,
        planAllowsCredit,
        globalModuleOn,
        canAccessManagerCreditReports,
        canAccessAdminCreditReports,
        showCreditReportCards,
        shouldUseAdminAccountingPanel: isAdminMaster,
        isLoading: profileLoading || companyLoading || billingLoading || moduleQuery.isLoading,
    };
}
