import { useEffect, useState } from 'react';
import { usePublicSiteContextOptional } from '@/contexts/PublicLaunchModeContext';
import { readCachedAuthSession, AUTH_SIGNED_IN_EVENT } from '@/utils/auth-session-cache';
import { AUTH_SIGNED_OUT_EVENT } from '@/utils/sign-out-session';

/**
 * ID do usuário logado — usa o contexto global quando disponível.
 * Fallback isolado só fora do provider (ex.: testes).
 */
export function useAuthUserId() {
    const siteCtx = usePublicSiteContextOptional();

    const [fallbackUserId, setFallbackUserId] = useState<string | undefined>(
        () => readCachedAuthSession().userId,
    );
    const [fallbackReady, setFallbackReady] = useState(
        () => !readCachedAuthSession().accessToken,
    );

    useEffect(() => {
        if (siteCtx) return;

        let cancelled = false;

        const clearSession = () => {
            if (cancelled) return;
            setFallbackUserId(undefined);
            setFallbackReady(true);
        };

        const onSignedIn = (event: Event) => {
            const detail = (event as CustomEvent<{ userId?: string }>).detail;
            if (cancelled || !detail?.userId) return;
            setFallbackUserId(detail.userId);
            setFallbackReady(true);
        };

        window.addEventListener(AUTH_SIGNED_OUT_EVENT, clearSession);
        window.addEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);

        return () => {
            cancelled = true;
            window.removeEventListener(AUTH_SIGNED_OUT_EVENT, clearSession);
            window.removeEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);
        };
    }, [siteCtx]);

    if (siteCtx) {
        return { userId: siteCtx.userId, sessionReady: siteCtx.sessionReady };
    }

    return { userId: fallbackUserId, sessionReady: fallbackReady };
}
