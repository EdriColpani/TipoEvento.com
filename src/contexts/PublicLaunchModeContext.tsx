import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import {
    canBypassPublicLaunchPreview,
    normalizePublicLaunchMode,
    type PublicLaunchMode,
} from '@/utils/public-launch-access';
import {
    PUBLIC_LAUNCH_MODE_QUERY_KEY,
    fetchPublicLaunchMode,
} from '@/hooks/use-public-launch-mode';

type PublicLaunchModeContextValue = {
    mode: PublicLaunchMode;
    isPreview: boolean;
    canBypassPreview: boolean;
    showPreLaunchExperience: boolean;
    isLoading: boolean;
    isError: boolean;
};

const PublicLaunchModeContext = createContext<PublicLaunchModeContextValue | null>(null);

export function PublicLaunchModeProvider({ children }: { children: React.ReactNode }) {
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [authReady, setAuthReady] = useState(false);

    useEffect(() => {
        let cancelled = false;

        supabase.auth.getSession().then(({ data: { session } }) => {
            if (cancelled) return;
            setUserId(session?.user?.id);
            setAuthReady(true);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setUserId(session?.user?.id);
            setAuthReady(true);
        });

        return () => {
            cancelled = true;
            subscription.unsubscribe();
        };
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(authReady && userId ? userId : undefined);

    const query = useQuery({
        queryKey: [...PUBLIC_LAUNCH_MODE_QUERY_KEY],
        queryFn: fetchPublicLaunchMode,
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        placeholderData: 'preview' as PublicLaunchMode,
    });

    const value = useMemo<PublicLaunchModeContextValue>(() => {
        const mode = query.data ?? 'preview';
        const tipo = Number(profile?.tipo_usuario_id);
        const isClient = tipo === 3;
        const loggedIn = authReady && Boolean(userId);
        const isPreview = mode === 'preview';
        const canBypassPreview = canBypassPublicLaunchPreview(profile?.tipo_usuario_id);

        // Visitante anônimo: pré-lançamento conforme configuração
        // Logado: só cliente (tipo 3) vê pré-lançamento; admin/gestor sempre vitrine completa
        let showPreLaunchExperience = isPreview && !loggedIn;
        if (loggedIn) {
            if (isLoadingProfile) {
                showPreLaunchExperience = false;
            } else {
                showPreLaunchExperience = isPreview && isClient;
            }
        }

        return {
            mode,
            isPreview,
            canBypassPreview,
            showPreLaunchExperience,
            isLoading: false,
            isError: query.isError,
        };
    }, [query.data, query.isError, profile?.tipo_usuario_id, authReady, userId, isLoadingProfile]);

    return (
        <PublicLaunchModeContext.Provider value={value}>{children}</PublicLaunchModeContext.Provider>
    );
}

export function usePublicLaunchModeContext(): PublicLaunchModeContextValue {
    const ctx = useContext(PublicLaunchModeContext);
    if (!ctx) {
        throw new Error('usePublicLaunchModeContext must be used within PublicLaunchModeProvider');
    }
    return ctx;
}
