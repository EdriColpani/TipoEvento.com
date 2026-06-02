import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode } from '@/constants/billing-plans';
import type { PlanFeatureKey } from '@/constants/plan-features';
import { PLAN_FEATURE_KEYS } from '@/constants/plan-features';
import { useSystemBillingSettings } from '@/hooks/use-system-billing-settings';
import {
    buildAllBillingPlanDisplays,
    type BillingPlanDisplayInfo,
    type BillingPlanFeaturesMatrix,
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

async function fetchBillingPlanFeaturesMatrix(): Promise<BillingPlanFeaturesMatrix> {
    const { data, error } = await supabase
        .from('billing_plan_features')
        .select('billing_plan, feature_key, enabled');

    if (error) throw new Error(error.message);

    const matrix: BillingPlanFeaturesMatrix = {};
    for (const row of data ?? []) {
        const plan = row.billing_plan as BillingPlanCode;
        const key = row.feature_key as PlanFeatureKey;
        if (!PLAN_FEATURE_KEYS.includes(key)) continue;
        if (!matrix[plan]) matrix[plan] = {};
        matrix[plan]![key] = row.enabled === true;
    }
    return matrix;
}

export function useBillingPlansCatalog(feeOverrides?: CompanyPlanFeeOverrides) {
    const { settings, isLoading: isLoadingSettings } = useSystemBillingSettings(true);

    const commissionQuery = useQuery({
        queryKey: ['publicCommissionRanges'],
        queryFn: fetchPublicCommissionRanges,
        staleTime: 1000 * 60 * 5,
    });

    const featuresQuery = useQuery({
        queryKey: ['billingPlanFeaturesMatrix'],
        queryFn: fetchBillingPlanFeaturesMatrix,
        staleTime: 1000 * 60 * 10,
    });

    const isLoading = isLoadingSettings || commissionQuery.isLoading || featuresQuery.isLoading;

    const displays: Partial<Record<BillingPlanCode, BillingPlanDisplayInfo>> = settings
        ? buildAllBillingPlanDisplays(
              settings,
              commissionQuery.data ?? [],
              featuresQuery.data ?? {},
              feeOverrides,
          )
        : {};

    return {
        displays,
        settings,
        commissionRanges: commissionQuery.data ?? [],
        featuresMatrix: featuresQuery.data,
        isLoading,
        isError: featuresQuery.isError && !settings,
    };
}
