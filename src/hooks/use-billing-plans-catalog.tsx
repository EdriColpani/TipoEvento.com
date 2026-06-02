import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode } from '@/constants/billing-plans';
import { useSystemBillingSettings } from '@/hooks/use-system-billing-settings';
import {
    buildAllBillingPlanDisplays,
    type BillingPlanDisplayInfo,
    type CompanyPlanFeeOverrides,
    type PublicCommissionRange,
} from '@/utils/billing-plan-catalog';

async function fetchPublicCommissionRanges(): Promise<PublicCommissionRange[]> {
    const { data, error } = await supabase.rpc('get_public_commission_ranges');
    if (!error && Array.isArray(data)) {
        return data as PublicCommissionRange[];
    }

    const { data: tableData, error: tableError } = await supabase
        .from('commission_ranges')
        .select('min_tickets, max_tickets, percentage')
        .eq('active', true)
        .order('min_tickets', { ascending: true });

    if (tableError) return [];
    return (tableData ?? []) as PublicCommissionRange[];
}

export function useBillingPlansCatalog(feeOverrides?: CompanyPlanFeeOverrides) {
    const { settings, isLoading: isLoadingSettings } = useSystemBillingSettings(true);

    const commissionQuery = useQuery({
        queryKey: ['publicCommissionRanges'],
        queryFn: fetchPublicCommissionRanges,
        staleTime: 1000 * 60 * 5,
    });

    const isLoading = isLoadingSettings || commissionQuery.isLoading;

    const displays: Partial<Record<BillingPlanCode, BillingPlanDisplayInfo>> = settings
        ? buildAllBillingPlanDisplays(settings, commissionQuery.data ?? [], feeOverrides)
        : {};

    return {
        displays,
        settings,
        commissionRanges: commissionQuery.data ?? [],
        isLoading,
    };
}
