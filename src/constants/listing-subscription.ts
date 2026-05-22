/** Fase da assinatura mensalidade vitrine (espelha get_listing_subscription_phase). */
export type ListingSubscriptionPhase =
    | 'active'
    | 'expiring_soon'
    | 'due_today'
    | 'past_due'
    | 'not_applicable';

export interface ListingSubscriptionState {
    phase: ListingSubscriptionPhase;
    days_left: number | null;
    listing_active_until: string | null;
    message: string | null;
}

export const MANAGER_LISTING_RENEWAL_PATH = '/manager/reports/listing-monthly';

const REPORTS_PREFIX = '/manager/reports';

/** Rotas permitidas com assinatura vencida (past_due). */
export function isManagerPathAllowedWhenListingPastDue(pathname: string): boolean {
    if (pathname.startsWith(REPORTS_PREFIX)) return true;
    if (pathname.startsWith('/manager/settings/company-profile')) return true;
    return false;
}

export function listingSubscriptionBlocksOperations(phase: ListingSubscriptionPhase): boolean {
    return phase === 'past_due';
}

export function listingSubscriptionNeedsBanner(phase: ListingSubscriptionPhase): boolean {
    return phase === 'expiring_soon' || phase === 'due_today' || phase === 'past_due';
}
