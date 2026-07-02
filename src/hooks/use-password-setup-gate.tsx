import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
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

        let cancelled = false;

        const enforce = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();
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
