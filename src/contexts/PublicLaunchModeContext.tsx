import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProfile } from '@/hooks/use-profile';
import { readCachedAuthSession, AUTH_SIGNED_IN_EVENT } from '@/utils/auth-session-cache';
import { fetchAuthUserViaRest } from '@/utils/auth-rest';
import { clearAuthSessionStorage, AUTH_SIGNED_OUT_EVENT } from '@/utils/sign-out-session';
import {
    canBypassPublicLaunchPreview,
    type PublicLaunchMode,
} from '@/utils/public-launch-access';
import {
    PUBLIC_LAUNCH_MODE_QUERY_KEY,
    fetchPublicLaunchMode,
} from '@/utils/public-launch-mode-query';

export type PublicSiteContextValue = {
    userId: string | undefined;
    userEmail: string | undefined;
    profile: ReturnType<typeof useProfile>['profile'];
    sessionReady: boolean;
    profileLoading: boolean;
    isAuthenticated: boolean;
    tipoUsuarioId: number | undefined;
    roleLoading: boolean;
    mode: PublicLaunchMode;
    isPreview: boolean;
    canBypassPreview: boolean;
    isError: boolean;
};

const PublicSiteContext = createContext<PublicSiteContextValue | null>(null);

export function PublicLaunchModeProvider({ children }: { children: React.ReactNode }) {
    const cached = readCachedAuthSession();
    const [userId, setUserId] = useState<string | undefined>(cached.userId);
    const [userEmail, setUserEmail] = useState<string | undefined>(cached.userEmail);
    const [sessionReady, setSessionReady] = useState(!cached.accessToken);

    useEffect(() => {
        let cancelled = false;

        const clearSession = () => {
            if (cancelled) return;
            setUserId(undefined);
            setUserEmail(undefined);
            setSessionReady(true);
        };

        const applyUser = (id: string, email?: string) => {
            if (cancelled) return;
            setUserId(id);
            setUserEmail(email);
            setSessionReady(true);
        };

        const boot = async () => {
            const stored = readCachedAuthSession();

            if (!stored.accessToken) {
                clearSession();
                return;
            }

            if (stored.userId) {
                applyUser(stored.userId, stored.userEmail);
            }

            const result = await fetchAuthUserViaRest(stored.accessToken, 5_000);
            if (cancelled) return;

            if (result.user) {
                applyUser(result.user.id, result.user.email ?? undefined);
                return;
            }

            if (result.error?.status === 401 || result.error?.status === 403) {
                clearAuthSessionStorage();
                clearSession();
                return;
            }

            if (stored.userId) {
                setSessionReady(true);
                return;
            }

            clearSession();
        };

        void boot();

        const onSignedIn = (event: Event) => {
            const detail = (event as CustomEvent<{ userId?: string; userEmail?: string }>).detail;
            if (cancelled || !detail?.userId) return;
            applyUser(detail.userId, detail.userEmail);
        };

        window.addEventListener(AUTH_SIGNED_OUT_EVENT, clearSession);
        window.addEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);

        return () => {
            cancelled = true;
            window.removeEventListener(AUTH_SIGNED_OUT_EVENT, clearSession);
            window.removeEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);
        };
    }, []);

    const { profile, isLoading: profileLoading } = useProfile(userId);

    const query = useQuery({
        queryKey: [...PUBLIC_LAUNCH_MODE_QUERY_KEY],
        queryFn: fetchPublicLaunchMode,
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        placeholderData: 'preview' as PublicLaunchMode,
    });

    const value = useMemo<PublicSiteContextValue>(() => {
        const mode = query.data ?? 'preview';
        const loggedIn = sessionReady && Boolean(userId);
        const isPreview = mode === 'preview';
        const tipo = profile?.tipo_usuario_id;
        const canBypassPreview = canBypassPublicLaunchPreview(tipo);

        return {
            userId,
            userEmail,
            profile,
            sessionReady,
            profileLoading,
            isAuthenticated: loggedIn,
            tipoUsuarioId: tipo,
            roleLoading: Boolean(userId && profileLoading),
            mode,
            isPreview,
            canBypassPreview,
            isError: query.isError,
        };
    }, [query.data, query.isError, profile, profileLoading, sessionReady, userEmail, userId]);

    return <PublicSiteContext.Provider value={value}>{children}</PublicSiteContext.Provider>;
}

export function usePublicSiteContext(): PublicSiteContextValue {
    const ctx = useContext(PublicSiteContext);
    if (!ctx) {
        throw new Error('usePublicSiteContext must be used within PublicLaunchModeProvider');
    }
    return ctx;
}

export function usePublicSiteContextOptional(): PublicSiteContextValue | null {
    return useContext(PublicSiteContext);
}

export function usePublicLaunchModeContext(): PublicSiteContextValue {
    return usePublicSiteContext();
}

export function usePublicSiteAuth() {
    const { userId, userEmail, profile, sessionReady, profileLoading, isAuthenticated, tipoUsuarioId, roleLoading } =
        usePublicSiteContext();
    return { userId, userEmail, profile, sessionReady, profileLoading, isAuthenticated, tipoUsuarioId, roleLoading };
}
