import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode } from '@/constants/billing-plans';
import { DEFAULT_SYSTEM_BILLING_SETTINGS, useSystemBillingSettings } from '@/hooks/use-system-billing-settings';
import {
    buildAllBillingPlanDisplays,
    type BillingPlanDisplayInfo,
    type CompanyPlanFeeOverrides,
    type PublicCommissionRange,
} from '@/utils/billing-plan-catalog';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';

async function fetchPublicCommissionRanges(): Promise<PublicCommissionRange[]> {
    try {
        const data = await callRpcRest<PublicCommissionRange[]>(
            'get_public_commission_ranges',
            {},
            8_000,
        );
        if (Array.isArray(data)) return data;
    } catch (restError) {
        console.warn('[useBillingPlansCatalog] RPC REST falhou:', restError);
    }

    try {
        const rows = await restGet<PublicCommissionRange[]>(
            'commission_ranges?select=min_tickets,max_tickets,percentage&active=eq.true&order=min_tickets.asc',
            8_000,
        );
        if (rows?.length) return rows;
    } catch (restError) {
        console.warn('[useBillingPlansCatalog] REST commission_ranges falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('get_public_commission_ranges'),
        8_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );
    if (!error && Array.isArray(data)) return data as PublicCommissionRange[];

    const { data: tableData } = await withTimeout(
        supabase
            .from('commission_ranges')
            .select('min_tickets, max_tickets, percentage')
            .eq('active', true)
            .order('min_tickets', { ascending: true }),
        8_000,
        { data: [], error: null },
    );

    return (tableData ?? []) as PublicCommissionRange[];
}

export function useBillingPlansCatalog(feeOverrides?: CompanyPlanFeeOverrides) {
    const { settings, isLoading: isLoadingSettings } = useSystemBillingSettings(true);

    const commissionQuery = useQuery({
        queryKey: ['publicCommissionRanges'],
        queryFn: () => withTimeout(fetchPublicCommissionRanges(), 10_000, []),
        staleTime: 1000 * 60 * 5,
        retry: 1,
        placeholderData: [],
    });

    const effectiveSettings = settings ?? DEFAULT_SYSTEM_BILLING_SETTINGS;
    const displays: Partial<Record<BillingPlanCode, BillingPlanDisplayInfo>> = buildAllBillingPlanDisplays(
        effectiveSettings,
        commissionQuery.data ?? [],
        feeOverrides,
    );

    const isLoading =
        (isLoadingSettings && !settings) ||
        (commissionQuery.isLoading && !commissionQuery.data);

    return {
        displays,
        settings: effectiveSettings,
        commissionRanges: commissionQuery.data ?? [],
        isLoading,
    };
}
