import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { isGuestAllowedPath, ADMIN_MASTER_USER_TYPE_ID } from '@/utils/public-launch-access';
import { isStaffUserType, resolveRoleHomePath } from '@/utils/role-home-path';
import { withTimeout } from '@/utils/promise-timeout';
import { fetchProfileTipoUsuarioId, normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';

const PUBLIC_HOME_PATHS = new Set(['/', '/informacoes']);

const ClientAuthGate: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [redirecting, setRedirecting] = useState(false);
    const [tipoFallback, setTipoFallback] = useState<number | undefined>();
    const [fallbackDone, setFallbackDone] = useState(false);
    const {
        sessionReady,
        isAuthenticated,
        userId,
        tipoUsuarioId,
        roleLoading,
    } = usePublicSiteAuth();

    const resolvedTipo =
        normalizeTipoUsuarioId(tipoUsuarioId) ?? normalizeTipoUsuarioId(tipoFallback);

    useEffect(() => {
        setTipoFallback(undefined);
        setFallbackDone(false);
    }, [userId]);

    useEffect(() => {
        if (!userId || !isAuthenticated) {
            setFallbackDone(true);
            return;
        }
        if (resolvedTipo != null) {
            setFallbackDone(true);
            return;
        }
        if (!PUBLIC_HOME_PATHS.has(location.pathname)) {
            setFallbackDone(true);
            return;
        }
        // Context ainda carregando — evita request duplicada.
        if (roleLoading) return;

        let cancelled = false;
        void fetchProfileTipoUsuarioId(userId)
            .then((tipo) => {
                if (!cancelled && tipo != null) setTipoFallback(tipo);
            })
            .finally(() => {
                if (!cancelled) setFallbackDone(true);
            });

        return () => {
            cancelled = true;
        };
    }, [userId, resolvedTipo, isAuthenticated, location.pathname, roleLoading]);

    useEffect(() => {
        if (!sessionReady || roleLoading || !isAuthenticated || !userId || resolvedTipo == null) {
            setRedirecting(false);
            return;
        }

        const path = location.pathname;

        if (path === '/informacoes' && resolvedTipo === 3) {
            navigate('/', { replace: true });
            return;
        }

        if (PUBLIC_HOME_PATHS.has(path) && isStaffUserType(resolvedTipo)) {
            let cancelled = false;
            setRedirecting(true);

            const fallback =
                resolvedTipo === ADMIN_MASTER_USER_TYPE_ID
                    ? '/admin/dashboard'
                    : '/manager/dashboard';

            void withTimeout(resolveRoleHomePath(userId, resolvedTipo), 6000, fallback).then(
                (target) => {
                    if (cancelled) return;
                    if (target !== path) {
                        navigate(target, { replace: true });
                    } else {
                        setRedirecting(false);
                    }
                },
            );

            return () => {
                cancelled = true;
            };
        }

        setRedirecting(false);
    }, [
        isAuthenticated,
        location.pathname,
        navigate,
        roleLoading,
        resolvedTipo,
        sessionReady,
        userId,
    ]);

    const waitingForRole =
        isAuthenticated &&
        resolvedTipo == null &&
        PUBLIC_HOME_PATHS.has(location.pathname) &&
        (roleLoading || !fallbackDone);

    if (!sessionReady || waitingForRole) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center bg-black px-4">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                <p className="mt-4 text-sm text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (redirecting) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center bg-black px-4">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                <p className="mt-4 text-sm text-gray-400">Redirecionando...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        if (location.pathname === '/' || !isGuestAllowedPath(location.pathname)) {
            return <Navigate to="/informacoes" replace state={{ from: location.pathname }} />;
        }
    }

    return <Outlet />;
};

export default ClientAuthGate;
