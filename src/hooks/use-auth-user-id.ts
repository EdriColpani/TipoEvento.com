import { useEffect, useState } from 'react';
import { usePublicSiteContextOptional } from '@/contexts/PublicLaunchModeContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * ID do usuário logado — usa o contexto global quando disponível.
 * Fallback isolado só fora do provider (ex.: testes).
 */
export function useAuthUserId() {
    const siteCtx = usePublicSiteContextOptional();

    const [fallbackUserId, setFallbackUserId] = useState<string | undefined>(undefined);
    const [fallbackReady, setFallbackReady] = useState(false);

    useEffect(() => {
        if (siteCtx) return;

        let cancelled = false;

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            if (cancelled) return;
            setFallbackUserId(session?.user?.id);
            setFallbackReady(true);
        });

        return () => {
            cancelled = true;
            subscription.unsubscribe();
        };
    }, [siteCtx]);

    if (siteCtx) {
        return { userId: siteCtx.userId, sessionReady: siteCtx.sessionReady };
    }

    return { userId: fallbackUserId, sessionReady: fallbackReady };
}
