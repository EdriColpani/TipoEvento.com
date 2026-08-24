import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { withTimeout } from '@/utils/promise-timeout';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';
import {
    hasPendingPromoterRegistration,
    loadCompanyRegisterDraft,
    isCompanyRegistrationPostponed,
} from '@/utils/manager-company-registration';
import { resolveManagerOnboardingPath } from '@/utils/manager-registration-kind';
import { peekComplimentaryReturnPath } from '@/utils/complimentary-auth-return';
import { isRegistrationBlockedByPreview } from '@/utils/public-launch-registration-block';
import {
    fetchManagerRegistrationGateStatus,
    MANAGER_REGISTRATION_CONTRACT_PATH,
} from '@/utils/manager-registration-contract-gate';
import { fetchProfileTipoUsuarioIdResilient } from '@/utils/fetch-profile-tipo';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const MANAGER_PRO_USER_TYPE_ID = 2;

/**
 * Após confirmar e-mail, o Supabase pode redirecionar para / ou /login.
 * Retoma o cadastro PF ou PJ conforme o tipo escolhido.
 * Se a empresa já foi criada, força assinatura do contrato (ignora postpone).
 * Admin Master nunca entra neste fluxo de contrato.
 */
export function usePromoterRegistrationResume() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (location.pathname.startsWith('/manager/register')) return;
        if (location.pathname.startsWith('/admin')) return;

        let cancelled = false;

        const resumeIfNeeded = async () => {
            if (location.pathname.startsWith('/cortesia/') || peekComplimentaryReturnPath()) {
                return;
            }

            if (await isRegistrationBlockedByPreview()) {
                return;
            }

            const cached = readCachedAuthSession();
            if (!cached.userId) return;

            const {
                data: { session },
            } = await withTimeout(supabase.auth.getSession(), 3_000, { data: { session: null } });
            if (cancelled || !session?.user || !isAuthEmailConfirmed(session.user)) {
                return;
            }

            const userType = await fetchProfileTipoUsuarioIdResilient(session.user.id);
            if (cancelled) return;

            // Dono do sistema e não-gestores: nunca forçar contrato de cadastro.
            if (userType === ADMIN_MASTER_USER_TYPE_ID || userType !== MANAGER_PRO_USER_TYPE_ID) {
                return;
            }

            const gateStatus = await fetchManagerRegistrationGateStatus(session.user.id);
            if (cancelled) return;

            if (gateStatus.pendingContractSigning) {
                if (location.pathname !== MANAGER_REGISTRATION_CONTRACT_PATH) {
                    navigate(MANAGER_REGISTRATION_CONTRACT_PATH, { replace: true });
                }
                return;
            }

            if (isCompanyRegistrationPostponed()) {
                return;
            }

            const hasDraft = Boolean(loadCompanyRegisterDraft());
            const pendingPromoter = hasPendingPromoterRegistration(session.user);
            if (!hasDraft && !pendingPromoter) return;

            const nextPath = resolveManagerOnboardingPath(session.user);
            if (location.pathname === nextPath) return;
            navigate(nextPath, { replace: true });
        };

        void resumeIfNeeded();

        const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (cancelled || !session?.user || !isAuthEmailConfirmed(session.user)) return;
            if (location.pathname.startsWith('/cortesia/') || peekComplimentaryReturnPath()) return;
            if (location.pathname.startsWith('/manager/register')) return;
            if (location.pathname.startsWith('/admin')) return;
            if (await isRegistrationBlockedByPreview()) return;

            const userType = await fetchProfileTipoUsuarioIdResilient(session.user.id);
            if (cancelled) return;
            if (userType === ADMIN_MASTER_USER_TYPE_ID || userType !== MANAGER_PRO_USER_TYPE_ID) {
                return;
            }

            const gateStatus = await fetchManagerRegistrationGateStatus(session.user.id);
            if (cancelled) return;

            if (gateStatus.pendingContractSigning) {
                if (location.pathname !== MANAGER_REGISTRATION_CONTRACT_PATH) {
                    navigate(MANAGER_REGISTRATION_CONTRACT_PATH, { replace: true });
                }
                return;
            }

            if (isCompanyRegistrationPostponed()) return;
            const hasDraft = Boolean(loadCompanyRegisterDraft());
            const pendingPromoter = hasPendingPromoterRegistration(session.user);
            if (!hasDraft && !pendingPromoter) return;
            const nextPath = resolveManagerOnboardingPath(session.user);
            if (location.pathname === nextPath) return;
            navigate(nextPath, { replace: true });
        });

        return () => {
            cancelled = true;
            authListener.subscription.unsubscribe();
        };
    }, [location.pathname, navigate]);
}
