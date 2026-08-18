import type { CompanyBillingFields } from '@/constants/billing-plans';

/** Contrato de cadastro da empresa (OTP em /manager/register). */
export const MANAGER_COMPANY_REGISTRATION_PATH = '/manager/register';

/**
 * Empresas que já tinham plano aceito antes deste gate (17/08/2026)
 * não são bloqueadas por falta do aceite OTP de cadastro.
 * Contas novas (ex.: teste no mesmo dia) continuam obrigadas a assinar.
 */
export const COMPANY_REGISTRATION_LEGACY_CUTOFF_ISO = '2026-08-17T00:00:00.000Z';

export type CompanyRegistrationAcceptanceLike = {
    contract_type?: string | null;
    acceptance_source?: string | null;
};

export function hasSignedCompanyRegistration(
    items?: CompanyRegistrationAcceptanceLike[] | null,
): boolean {
    return Boolean(
        items?.some(
            (row) =>
                row.contract_type === 'company_registration' ||
                row.acceptance_source === 'manager_register',
        ),
    );
}

export function isLegacyCompanyRegistrationWaived(
    billing: CompanyBillingFields | null | undefined,
): boolean {
    const acceptedAt = billing?.billing_plan_accepted_at;
    if (!acceptedAt) return false;
    const ts = Date.parse(acceptedAt);
    if (!Number.isFinite(ts)) return false;
    return ts < Date.parse(COMPANY_REGISTRATION_LEGACY_CUTOFF_ISO);
}

/** Pode operar (e escolher plano) sem o OTP de cadastro: assinou ou é legado. */
export function isCompanyRegistrationSatisfied(
    signed: boolean,
    billing: CompanyBillingFields | null | undefined,
): boolean {
    return signed || isLegacyCompanyRegistrationWaived(billing);
}

export function requiresManagerCompanyRegistrationAcceptance(
    isManagerPro: boolean,
    isAdminMaster: boolean,
    companyId: string | undefined,
    signed: boolean,
    billing: CompanyBillingFields | null | undefined,
    gatesLoaded = true,
): boolean {
    if (isAdminMaster || !isManagerPro || !companyId || !gatesLoaded) return false;
    return !isCompanyRegistrationSatisfied(signed, billing);
}

export const MANAGER_REGISTRATION_GATE_TOAST =
    'Assine o contrato de cadastro da empresa para usar o painel e escolher um plano.';
