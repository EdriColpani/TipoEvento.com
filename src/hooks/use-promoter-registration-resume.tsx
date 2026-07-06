import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { withTimeout } from '@/utils/promise-timeout';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';
import {
    hasPendingPromoterRegistration,
    loadCompanyRegisterDraft,
    MANAGER_COMPANY_REGISTER_DRAFT_KEY,
    MANAGER_COMPANY_REGISTER_PATH,
} from '@/utils/manager-company-registration';
import { peekComplimentaryReturnPath } from '@/utils/complimentary-auth-return';
import { isRegistrationBlockedByPreview } from '@/utils/public-launch-registration-block';

/**
 * Após confirmar e-mail, o Supabase pode redirecionar para / ou /login.
 * Envia o usuário ao cadastro de empresa quando há rascunho ou flag de promotor.
 */
export function usePromoterRegistrationResume() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (location.pathname === MANAGER_COMPANY_REGISTER_PATH) return;

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

            const hasDraft = Boolean(loadCompanyRegisterDraft());
            const pendingPromoter = hasPendingPromoterRegistration(session.user);
            if (!hasDraft && !pendingPromoter) return;

            navigate(MANAGER_COMPANY_REGISTER_PATH, { replace: true });
        };

        void resumeIfNeeded();

        const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (cancelled || !session?.user || !isAuthEmailConfirmed(session.user)) return;
            if (location.pathname.startsWith('/cortesia/') || peekComplimentaryReturnPath()) return;
            if (await isRegistrationBlockedByPreview()) return;
            const hasDraft = Boolean(sessionStorage.getItem(MANAGER_COMPANY_REGISTER_DRAFT_KEY));
            const pendingPromoter = hasPendingPromoterRegistration(session.user);
            if ((hasDraft || pendingPromoter) && location.pathname !== MANAGER_COMPANY_REGISTER_PATH) {
                navigate(MANAGER_COMPANY_REGISTER_PATH, { replace: true });
            }
        });

        return () => {
            cancelled = true;
            authListener.subscription.unsubscribe();
        };
    }, [location.pathname, navigate]);
}
