import type { BillingPlanCode } from '@/constants/billing-plans';

/** Planos com venda de ingressos pela plataforma (comissão + híbrido). */
export function companyAllowsTicketSales(plan: BillingPlanCode | string | null | undefined): boolean {
    return plan === 'ticket_commission' || plan === 'ticket_plus_consumption';
}

export function isListingMonthlyPlan(plan: BillingPlanCode | string | null | undefined): boolean {
    return plan === 'listing_monthly';
}

export function isHybridPlan(plan: BillingPlanCode | string | null | undefined): boolean {
    return plan === 'ticket_plus_consumption';
}

export function isConsumptionOrLicensePlan(plan: BillingPlanCode | string | null | undefined): boolean {
    return plan === 'consumption_or_license';
}

/** Eventos só divulgação (sem ingressos pagos na plataforma). */
export function isListingOnlyCompanyPlan(plan: BillingPlanCode | string | null | undefined): boolean {
    return plan === 'listing_monthly' || plan === 'consumption_or_license';
}

export const DEFAULT_LISTING_MONTHLY_FEE = 199.9;
