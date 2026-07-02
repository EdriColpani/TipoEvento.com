import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * ID do usuário logado via sessão local (getSession).
 * Evita getUser() nas páginas — reduz deadlock com updateUser/onAuthStateChange.
 */
export function useAuthUserId() {
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [sessionReady, setSessionReady] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const applySession = (id?: string) => {
            if (cancelled) return;
            setUserId(id);
            setSessionReady(true);
        };

        void supabase.auth.getSession().then(({ data: { session } }) => {
            applySession(session?.user?.id);
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!cancelled) {
                setUserId(session?.user?.id);
            }
        });

        return () => {
            cancelled = true;
            authListener.subscription.unsubscribe();
        };
    }, []);

    return { userId, sessionReady };
}
