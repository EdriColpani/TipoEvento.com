import type { BillingPlanCode } from '@/constants/billing-plans';

/** Empresa pode vender ingressos pela plataforma (comissão sobre vendas). */
export function companyAllowsTicketSales(plan: BillingPlanCode | string | null | undefined): boolean {
    return plan !== 'listing_monthly';
}

export function isListingMonthlyPlan(plan: BillingPlanCode | string | null | undefined): boolean {
    return plan === 'listing_monthly';
}

export const DEFAULT_LISTING_MONTHLY_FEE = 199.9;
