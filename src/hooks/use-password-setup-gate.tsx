import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { withTimeout } from '@/utils/promise-timeout';
import {
    RESET_PASSWORD_PATH,
    userMustSetPartnerPassword,
} from '@/utils/partner-password-setup';

/**
 * Bloqueia o app até o gestor convidado criar senha (link invite/recovery/magiclink antigo).
 * Só verifica na mudança de rota — evita deadlock com updateUser no /reset-password.
 */
export function usePasswordSetupGate() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (location.pathname === RESET_PASSWORD_PATH) return;
        if (location.pathname.startsWith('/admin')) return;

        let cancelled = false;

        const enforce = async () => {
            const cached = readCachedAuthSession();
            if (!cached.userId) return;

            const {
                data: { session },
            } = await withTimeout(supabase.auth.getSession(), 3_000, { data: { session: null } });
            const user = session?.user;
            if (cancelled || !user || !(await userMustSetPartnerPassword(user))) return;
            navigate(RESET_PASSWORD_PATH, { replace: true });
        };

        const timer = window.setTimeout(() => {
            void enforce();
        }, 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [location.pathname, navigate]);
}
