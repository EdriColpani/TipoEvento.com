import { supabase } from '@/integrations/supabase/client';
import {
    PLAN_FEATURE_DEFINITIONS,
    type PlanFeatureKey,
} from '@/constants/plan-features';

/** Verifica no servidor se a empresa tem a feature do plano (ignora admin no RPC). */
export async function companyHasPlanFeature(
    companyId: string,
    featureKey: PlanFeatureKey,
): Promise<boolean> {
    const { data, error } = await supabase.rpc('company_has_plan_feature', {
        p_company_id: companyId,
        p_feature_key: featureKey,
    });
    if (error) throw error;
    return data === true;
}

export function planFeatureDeniedMessage(featureKey: PlanFeatureKey): string {
    const label =
        PLAN_FEATURE_DEFINITIONS.find((d) => d.key === featureKey)?.label ?? featureKey;
    return `O recurso "${label}" não está disponível no plano comercial da sua empresa. Entre em contato com a EventFest ou peça ao administrador.`;
}

/** Pré-validação no front antes de INSERT; o banco também valida via triggers. */
export async function assertCompanyPlanFeature(
    companyId: string | null | undefined,
    featureKey: PlanFeatureKey,
): Promise<void> {
    if (!companyId) {
        throw new Error('Empresa não vinculada à sua conta.');
    }
    const allowed = await companyHasPlanFeature(companyId, featureKey);
    if (!allowed) {
        throw new Error(planFeatureDeniedMessage(featureKey));
    }
}
