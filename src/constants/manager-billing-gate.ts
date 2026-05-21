import type { CompanyBillingFields } from '@/constants/billing-plans';
import { isCompanyBillingReady } from '@/constants/billing-plans';

/** Perfil da empresa — aba Plano e cobrança (aceite de contrato). */
export const MANAGER_BILLING_SETUP_PATH = '/manager/settings/company-profile?tab=billing';

const ALLOWED_PREFIXES = ['/manager/settings/company-profile'];

export function isManagerPathAllowedWithoutBilling(pathname: string): boolean {
    return ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Rotas do menu PRO bloqueadas até aceitar o contrato do plano. */
export function isManagerNavItemLocked(navPath: string, requiresContractAcceptance: boolean): boolean {
    if (!requiresContractAcceptance) return false;
    if (navPath === '/') return false;
    if (isManagerPathAllowedWithoutBilling(navPath)) return false;
    if (navPath.startsWith('/manager') || navPath.startsWith('/admin')) return true;
    return false;
}

export function requiresManagerCompanyBillingAcceptance(
    isManagerPro: boolean,
    isAdminMaster: boolean,
    companyId: string | undefined,
    billing: CompanyBillingFields | null | undefined,
): boolean {
    if (isAdminMaster || !isManagerPro || !companyId) return false;
    return !isCompanyBillingReady(billing);
}
