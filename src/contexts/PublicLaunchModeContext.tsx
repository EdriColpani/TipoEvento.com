import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
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
    const [sessionReady, setSessionReady] = useState(Boolean(cached.userId));

    useEffect(() => {
        let cancelled = false;
        let readyTimeout: ReturnType<typeof setTimeout> | undefined;

        const applySession = (session: { user?: { id?: string; email?: string | null } } | null) => {
            if (cancelled) return;
            if (readyTimeout) {
                clearTimeout(readyTimeout);
                readyTimeout = undefined;
            }
            setUserId(session?.user?.id);
            setUserEmail(session?.user?.email ?? undefined);
            setSessionReady(true);
        };

        readyTimeout = window.setTimeout(() => {
            if (!cancelled) {
                const cached = readCachedAuthSession();
                if (cached.userId) {
                    setUserId(cached.userId);
                    setUserEmail(cached.userEmail);
                }
                setSessionReady(true);
            }
        }, 3000);

        void supabase.auth.getSession().then(({ data: { session } }) => {
            applySession(session);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            applySession(session);
        });

        return () => {
            cancelled = true;
            if (readyTimeout) clearTimeout(readyTimeout);
            subscription.unsubscribe();
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
