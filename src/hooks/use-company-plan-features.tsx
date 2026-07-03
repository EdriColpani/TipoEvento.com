import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PlanFeatureKey, PlanFeaturesMap } from '@/constants/plan-features';
import { PLAN_FEATURE_KEYS } from '@/constants/plan-features';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

function parsePlanFeaturesRpc(data: unknown): PlanFeaturesMap {
    if (!data || typeof data !== 'object') return {};
    const raw = data as Record<string, unknown>;
    const map: PlanFeaturesMap = {};
    for (const key of PLAN_FEATURE_KEYS) {
        if (raw[key] === true) map[key] = true;
    }
    return map;
}

async function fetchCompanyPlanFeatures(companyId: string): Promise<PlanFeaturesMap> {
    try {
        const data = await callRpcRest<unknown>('get_company_plan_features', {
            p_company_id: companyId,
        }, 8_000);
        return parsePlanFeaturesRpc(data);
    } catch (restError) {
        console.warn('[useCompanyPlanFeatures] REST RPC falhou:', restError);
    }

    try {
        const { data, error } = await withTimeout(
            supabase.rpc('get_company_plan_features', { p_company_id: companyId }),
            8_000,
            { data: null, error: { message: 'timeout' } as { message: string } },
        );
        if (error) {
            console.warn('get_company_plan_features:', error.message);
            return {};
        }
        return parsePlanFeaturesRpc(data);
    } catch (e) {
        console.warn('get_company_plan_features failed', e);
        return {};
    }
}

export function useCompanyPlanFeatures(
    companyId: string | undefined,
    options?: { isAdminMaster?: boolean; enabled?: boolean },
) {
    const isAdminMaster = options?.isAdminMaster ?? false;
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['companyPlanFeatures', companyId],
        queryFn: () => fetchCompanyPlanFeatures(companyId!),
        enabled: (options?.enabled ?? true) && !!companyId && !isAdminMaster,
        staleTime: 1000 * 60 * 2,
        retry: 1,
        placeholderData: {},
    });

    return {
        ...query,
        features: isAdminMaster ? null : query.data,
        invalidate: () =>
            queryClient.invalidateQueries({ queryKey: ['companyPlanFeatures', companyId] }),
    };
}

export function useInvalidateCompanyPlanFeatures() {
    const queryClient = useQueryClient();
    return (companyId: string | undefined) => {
        if (companyId) {
            queryClient.invalidateQueries({ queryKey: ['companyPlanFeatures', companyId] });
        }
    };
}

export type { PlanFeatureKey, PlanFeaturesMap };
