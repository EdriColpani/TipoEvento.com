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
} from '@/hooks/use-public-launch-mode';

export type PublicSiteContextValue = {
    userId: string | undefined;
    profile: ReturnType<typeof useProfile>['profile'];
    sessionReady: boolean;
    profileLoading: boolean;
    isAuthenticated: boolean;
    tipoUsuarioId: number | undefined;
    mode: PublicLaunchMode;
    isPreview: boolean;
    canBypassPreview: boolean;
    showPreLaunchExperience: boolean;
    isError: boolean;
};

const PublicSiteContext = createContext<PublicSiteContextValue | null>(null);

export function PublicLaunchModeProvider({ children }: { children: React.ReactNode }) {
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [sessionReady, setSessionReady] = useState(false);

    useEffect(() => {
        let cancelled = false;

        supabase.auth.getSession().then(({ data: { session } }) => {
            if (cancelled) return;
            setUserId(session?.user?.id);
            setSessionReady(true);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setUserId(session?.user?.id);
            setSessionReady(true);
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
        const tipo = Number(profile?.tipo_usuario_id);
        const isClient = tipo === 3;
        const loggedIn = sessionReady && Boolean(userId);
        const isPreview = mode === 'preview';
        const canBypassPreview = canBypassPublicLaunchPreview(profile?.tipo_usuario_id);

        let showPreLaunchExperience = isPreview && !loggedIn;
        if (loggedIn) {
            if (profileLoading) {
                showPreLaunchExperience = false;
            } else {
                showPreLaunchExperience = isPreview && isClient;
            }
        }

        return {
            userId,
            profile,
            sessionReady,
            profileLoading,
            isAuthenticated: loggedIn,
            tipoUsuarioId: profile?.tipo_usuario_id,
            mode,
            isPreview,
            canBypassPreview,
            showPreLaunchExperience,
            isError: query.isError,
        };
    }, [query.data, query.isError, profile, profileLoading, sessionReady, userId]);

    return <PublicSiteContext.Provider value={value}>{children}</PublicSiteContext.Provider>;
}

export function usePublicSiteContext(): PublicSiteContextValue {
    const ctx = useContext(PublicSiteContext);
    if (!ctx) {
        throw new Error('usePublicSiteContext must be used within PublicLaunchModeProvider');
    }
    return ctx;
}

export function usePublicLaunchModeContext(): PublicSiteContextValue {
    return usePublicSiteContext();
}

export function usePublicSiteAuth() {
    const { userId, profile, sessionReady, profileLoading, isAuthenticated, tipoUsuarioId } =
        usePublicSiteContext();
    return { userId, profile, sessionReady, profileLoading, isAuthenticated, tipoUsuarioId };
}
