import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
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
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
    const [sessionReady, setSessionReady] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const applySession = (session: { user?: { id?: string; email?: string | null } } | null) => {
            if (cancelled) return;
            setUserId(session?.user?.id);
            setUserEmail(session?.user?.email ?? undefined);
            setSessionReady(true);
        };

        // Sessão inicial do storage local (obrigatório — onAuthStateChange sozinho pode não disparar).
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
            subscription.unsubscribe();
        };
    }, []);

    const { profile, isLoading: profileLoading } = useProfile(sessionReady && userId ? userId : undefined);

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
