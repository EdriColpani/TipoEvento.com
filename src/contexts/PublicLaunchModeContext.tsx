import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useProfile } from '@/hooks/use-profile';
import { useUserRole } from '@/hooks/use-user-role';
import { readCachedAuthSession, AUTH_SIGNED_IN_EVENT, isAccessTokenTimeValid, isAuthApiRejectedStatus } from '@/utils/auth-session-cache';
import { fetchAuthUserViaRest, refreshSessionViaRest } from '@/utils/auth-rest';
import { clearAuthSessionIfCurrentToken, clearAuthSessionStorage, AUTH_SIGNED_OUT_EVENT } from '@/utils/sign-out-session';
import { normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';
import { shouldStayOnLoginForPassword } from '@/utils/auth-url-callback';
import type { PublicLaunchMode } from '@/utils/public-launch-access';

export type PublicSiteContextValue = {
    userId: string | undefined;
    userEmail: string | undefined;
    profile: ReturnType<typeof useProfile>['profile'];
    sessionReady: boolean;
    profileLoading: boolean;
    isAuthenticated: boolean;
    tipoUsuarioId: number | undefined;
    roleLoading: boolean;
    /** Sempre `live` — pré-lançamento removido. */
    mode: PublicLaunchMode;
    modeReady: boolean;
    /** Sempre false — site público sempre aberto. */
    isPreview: boolean;
    canBypassPreview: boolean;
    isError: boolean;
};

const PublicSiteContext = createContext<PublicSiteContextValue | null>(null);

export function PublicLaunchModeProvider({ children }: { children: React.ReactNode }) {
    // Não assume logado pelo cache: evita Menu Avatar ↔ Login piscando com JWT morto.
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
    const [sessionReady, setSessionReady] = useState(false);

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
            if (shouldStayOnLoginForPassword()) {
                clearSession();
                return;
            }
            setUserId(id);
            setUserEmail(email);
            setSessionReady(true);
        };

        const boot = async () => {
            if (shouldStayOnLoginForPassword()) {
                clearAuthSessionStorage();
                clearSession();
                return;
            }

            const stored = readCachedAuthSession();

            if (!stored.accessToken && !stored.refreshToken) {
                clearSession();
                return;
            }

            // Access token vencido: tenta refresh antes de deslogar.
            // Sem isso, o retorno do Mercado Pago (full reload) apaga a sessão
            // mesmo com refresh_token válido no mesmo domínio.
            if (!stored.accessToken || !isAccessTokenTimeValid(stored.accessToken)) {
                const refreshed = await refreshSessionViaRest(8_000);
                if (cancelled) return;
                if (refreshed?.id) {
                    applyUser(refreshed.id, refreshed.email ?? undefined);
                    return;
                }
                clearAuthSessionStorage();
                clearSession();
                return;
            }

            const result = await fetchAuthUserViaRest(stored.accessToken, 5_000);
            if (cancelled) return;

            if (result.user) {
                applyUser(result.user.id, result.user.email ?? undefined);
                return;
            }

            // 401/403: tenta refresh uma vez antes de limpar (JWT rejeitado mas refresh ok).
            if (isAuthApiRejectedStatus(result.error?.status)) {
                const refreshed = await refreshSessionViaRest(8_000);
                if (cancelled) return;
                if (refreshed?.id) {
                    applyUser(refreshed.id, refreshed.email ?? undefined);
                    return;
                }
                if (clearAuthSessionIfCurrentToken(stored.accessToken)) {
                    clearSession();
                } else {
                    clearSession();
                }
                return;
            }

            // Rede/timeout: só mantém se o JWT ainda está no prazo e há userId.
            if (
                stored.userId &&
                isAccessTokenTimeValid(stored.accessToken) &&
                (result.error?.message === 'timeout' || result.error?.message === 'network_error')
            ) {
                applyUser(stored.userId, stored.userEmail);
                return;
            }

            clearAuthSessionIfCurrentToken(stored.accessToken);
            clearSession();
        };

        void boot();

        const onSignedIn = (event: Event) => {
            const detail = (event as CustomEvent<{ userId?: string; userEmail?: string }>).detail;
            if (cancelled || !detail?.userId) return;
            if (shouldStayOnLoginForPassword()) return;
            applyUser(detail.userId, detail.userEmail);
        };

        const onSignedOut = () => {
            clearSession();
        };

        window.addEventListener(AUTH_SIGNED_OUT_EVENT, onSignedOut);
        window.addEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);

        return () => {
            cancelled = true;
            window.removeEventListener(AUTH_SIGNED_OUT_EVENT, onSignedOut);
            window.removeEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);
        };
    }, []);

    const { profile, isLoading: profileLoading } = useProfile(userId);
    const {
        tipoUsuarioId: roleTipo,
        isLoading: roleTipoLoading,
        isFetched: roleTipoFetched,
    } = useUserRole(userId);

    const value = useMemo<PublicSiteContextValue>(() => {
        const loggedIn = sessionReady && Boolean(userId);
        const tipo =
            normalizeTipoUsuarioId(roleTipo) ??
            normalizeTipoUsuarioId(profile?.tipo_usuario_id);
        const roleLoading = Boolean(
            userId &&
                tipo == null &&
                (!roleTipoFetched || roleTipoLoading || profileLoading),
        );

        return {
            userId,
            userEmail,
            profile,
            sessionReady,
            profileLoading,
            isAuthenticated: loggedIn,
            tipoUsuarioId: tipo,
            roleLoading,
            mode: 'live',
            modeReady: true,
            isPreview: false,
            canBypassPreview: true,
            isError: false,
        };
    }, [
        profile,
        profileLoading,
        roleTipo,
        roleTipoFetched,
        roleTipoLoading,
        sessionReady,
        userEmail,
        userId,
    ]);

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
    const {
        userId,
        userEmail,
        profile,
        sessionReady,
        profileLoading,
        isAuthenticated,
        tipoUsuarioId,
        roleLoading,
        mode,
        modeReady,
        isPreview,
        canBypassPreview,
    } = usePublicSiteContext();
    return {
        userId,
        userEmail,
        profile,
        sessionReady,
        profileLoading,
        isAuthenticated,
        tipoUsuarioId,
        roleLoading,
        mode,
        modeReady,
        isPreview,
        canBypassPreview,
    };
}
