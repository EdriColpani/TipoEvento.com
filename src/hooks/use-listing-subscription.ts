import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ListingSubscriptionPhase, ListingSubscriptionState } from '@/constants/listing-subscription';
import { isListingMonthlyPlan } from '@/utils/company-billing-rules';
import type { BillingPlanCode } from '@/constants/billing-plans';

async function fetchListingSubscriptionPhase(companyId: string): Promise<ListingSubscriptionState> {
    const { data, error } = await supabase.rpc('get_listing_subscription_phase', {
        p_company_id: companyId,
    });
    if (error) throw new Error(error.message);

    const row = (data ?? {}) as Record<string, unknown>;
    return {
        phase: (row.phase as ListingSubscriptionPhase) ?? 'not_applicable',
        days_left: typeof row.days_left === 'number' ? row.days_left : null,
        listing_active_until: (row.listing_active_until as string) ?? null,
        message: (row.message as string) ?? null,
    };
}

export function useListingSubscription(
    companyId: string | undefined,
    billingPlan: BillingPlanCode | null | undefined,
) {
    const enabled = Boolean(companyId && isListingMonthlyPlan(billingPlan ?? null));

    return useQuery({
        queryKey: ['listingSubscription', companyId],
        queryFn: () => fetchListingSubscriptionPhase(companyId!),
        enabled,
        staleTime: 60_000,
        refetchInterval: enabled ? 120_000 : false,
    });
}
