import type { BillingPlanCode, CompanyBillingFields } from '@/constants/billing-plans';
import { getBillingPlanLabel, isCompanyBillingReady } from '@/constants/billing-plans';

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
    /** false enquanto o plano/contrato ainda está sendo carregado — evita redirecionar indevidamente */
    billingLoaded = true,
): boolean {
    if (isAdminMaster || !isManagerPro || !companyId || !billingLoaded) return false;
    return !isCompanyBillingReady(billing);
}

/**
 * Reaceite: empresa já tinha plano e a plataforma pediu novo aceite (ex.: contrato atualizado).
 * Diferente da confirmação inicial / migração de plano.
 */
export function isBillingContractReacceptance(
    billing: CompanyBillingFields | null | undefined,
): boolean {
    if (!billing?.requires_billing_reacceptance) return false;
    return Boolean(billing.billing_plan);
}

export function getBillingGateBannerMessage(
    billing: CompanyBillingFields | null | undefined,
): string {
    if (isBillingContractReacceptance(billing)) {
        const planLabel = getBillingPlanLabel(billing?.billing_plan as BillingPlanCode | null);
        return (
            `O contrato do seu plano atual (${planLabel}) foi atualizado e precisa ser aceito novamente. ` +
            'Abra a aba Plano e cobrança, revise o texto e confirme o aceite para liberar o Dashboard e o restante do menu.'
        );
    }
    return (
        'Para liberar o Dashboard e o restante do menu, confirme o plano e aceite o contrato na aba Plano e cobrança abaixo.'
    );
}

export function getBillingGateToastMessage(
    billing: CompanyBillingFields | null | undefined,
): string {
    if (isBillingContractReacceptance(billing)) {
        const planLabel = getBillingPlanLabel(billing?.billing_plan as BillingPlanCode | null);
        return (
            `Contrato do plano ${planLabel} atualizado. Aceite a nova versão em Plano e cobrança para continuar.`
        );
    }
    return (
        'Confirme o plano e aceite o contrato da empresa na aba Plano e cobrança para acessar o painel do gestor.'
    );
}
