import { useEffect, useState } from 'react';
import { useAuthUserId } from '@/hooks/use-auth-user-id';

/** Sessão de página — evita spinner infinito quando getSession/getUser trava. */
export function usePageAuth(bootMs = 5000) {
    const { userId, sessionReady } = useAuthUserId();
    const [bootExpired, setBootExpired] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setBootExpired(true), bootMs);
        return () => window.clearTimeout(timer);
    }, [bootMs]);

    const authPending = !sessionReady && !bootExpired;

    return {
        userId,
        sessionReady,
        authPending,
        bootExpired,
        isAuthenticated: sessionReady && Boolean(userId),
    };
}
