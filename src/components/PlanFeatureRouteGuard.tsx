import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyPlanFeatures } from '@/hooks/use-company-plan-features';
import { isCompanyBillingReady } from '@/constants/billing-plans';
import { isRouteBlockedByPlan, resolveFeatureForPath } from '@/constants/plan-features';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { MANAGER_BILLING_SETUP_PATH } from '@/constants/manager-billing-gate';
import { supabase } from '@/integrations/supabase/client';

const ADMIN_MASTER = 1;
const MANAGER_PRO = 2;

interface PlanFeatureRouteGuardProps {
    children: React.ReactNode;
}

function GuardSpinner() {
    return (
        <div className="py-20 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mx-auto" />
        </div>
    );
}

/**
 * Bloqueia rotas do gestor quando o plano da empresa não inclui a funcionalidade.
 * Admin Master ignora. Contrato pendente é tratado pelo ManagerLayout.
 */
const PlanFeatureRouteGuard: React.FC<PlanFeatureRouteGuardProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [userId, setUserId] = React.useState<string | undefined>();

    React.useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user?.id));
    }, []);

    const featureKey = resolveFeatureForPath(location.pathname);
    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const tipo = Number(profile?.tipo_usuario_id);
    const isAdminMaster = tipo === ADMIN_MASTER;
    const isManagerPro = tipo === MANAGER_PRO;
    const needsPlanGate = Boolean(featureKey && isManagerPro && !isAdminMaster);

    const { company, isLoading: loadingCompany, isError: companyError } = useManagerCompany(
        needsPlanGate ? userId : undefined,
    );
    const { billing, isLoading: loadingBilling, isError: billingError } = useCompanyBilling(
        needsPlanGate && company?.id ? company.id : undefined,
    );
    const billingReady = isCompanyBillingReady(billing);
    const { features, isLoading: loadingFeatures, isError: featuresError } = useCompanyPlanFeatures(
        company?.id,
        { isAdminMaster, enabled: needsPlanGate && !!company?.id },
    );

    if (!featureKey || !needsPlanGate) {
        return <>{children}</>;
    }

    if (!userId || (loadingProfile && !profile)) {
        return <GuardSpinner />;
    }

    if (!company?.id) {
        return <>{children}</>;
    }

    const waitingPlanData =
        (loadingCompany && !companyError) ||
        (loadingBilling && !billingError) ||
        (loadingFeatures && !featuresError);

    if (waitingPlanData) {
        return <GuardSpinner />;
    }

    if (isRouteBlockedByPlan(location.pathname, features, false, billingReady)) {
        return (
            <div className="max-w-lg mx-auto py-16 px-4 text-center">
                <Lock className="h-12 w-12 text-amber-400 mx-auto mb-4" />
                <h2 className="text-xl text-white font-semibold mb-2">Recurso não disponível</h2>
                <p className="text-gray-400 text-sm mb-6">
                    Esta área não faz parte do seu plano comercial atual. Altere o plano e aceite o novo
                    contrato em Plano e cobrança, ou fale com o administrador.
                </p>
                <Button
                    type="button"
                    className="bg-cyan-500 text-black hover:bg-cyan-400"
                    onClick={() => navigate(MANAGER_BILLING_SETUP_PATH)}
                >
                    Ir para Plano e cobrança
                </Button>
            </div>
        );
    }

    return <>{children}</>;
};

export default PlanFeatureRouteGuard;

/** Wrapper para rotas aninhadas no React Router 6 */
export function withPlanFeatureGuard(element: React.ReactElement) {
    return <PlanFeatureRouteGuard>{element}</PlanFeatureRouteGuard>;
}
