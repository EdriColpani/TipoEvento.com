import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { isGuestAllowedPath } from '@/utils/public-launch-access';
import { fetchProfileTipoUsuarioId, normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';

const PUBLIC_HOME_PATHS = new Set(['/', '/informacoes']);

const ClientAuthGate: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [tipoFallback, setTipoFallback] = useState<number | undefined>();
    const [fallbackDone, setFallbackDone] = useState(false);
    const {
        sessionReady,
        isAuthenticated,
        userId,
        tipoUsuarioId,
        roleLoading,
        isPreview,
        modeReady,
        canBypassPreview,
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
        if (!sessionReady || roleLoading || !isAuthenticated || resolvedTipo == null) {
            return;
        }

        // Em pré-lançamento, cliente também permanece em /informacoes (não força a vitrine).
        if (isPreview) return;

        // Cliente na landing institucional → vitrine de eventos (somente site ao vivo)
        if (location.pathname === '/informacoes' && resolvedTipo === 3) {
            navigate('/', { replace: true });
        }
    }, [
        isAuthenticated,
        isPreview,
        location.pathname,
        navigate,
        roleLoading,
        resolvedTipo,
        sessionReady,
    ]);

    const waitingForRole =
        isAuthenticated &&
        resolvedTipo == null &&
        PUBLIC_HOME_PATHS.has(location.pathname) &&
        (roleLoading || !fallbackDone);

    if (!sessionReady || waitingForRole || !modeReady) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center bg-black px-4">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                <p className="mt-4 text-sm text-gray-400">Carregando...</p>
            </div>
        );
    }

    const fullFrom = `${location.pathname}${location.search}`;
    const isClientPrivatePath =
        location.pathname === '/tickets' ||
        location.pathname === '/profile' ||
        location.pathname === '/wallet' ||
        location.pathname.startsWith('/wallet/');

    if (!isAuthenticated) {
        // Retorno do Mercado Pago / área logada: manda para login com returnTo,
        // não para /informacoes (parecia "deslogou e perdeu a compra").
        if (isClientPrivatePath) {
            return <Navigate to="/login" replace state={{ from: fullFrom }} />;
        }

        // Pré-lançamento marcado: URL obrigatória /informacoes
        if (isPreview && (location.pathname === '/' || !isGuestAllowedPath(location.pathname))) {
            return <Navigate to="/informacoes" replace state={{ from: fullFrom }} />;
        }

        // Site ao vivo: visitante pode ficar em /
        if (!isPreview && !isGuestAllowedPath(location.pathname) && location.pathname !== '/') {
            return <Navigate to="/login" replace state={{ from: fullFrom }} />;
        }
    } else if (isPreview && !canBypassPreview && location.pathname === '/') {
        // Cliente logado em pré-lançamento também cai em /informacoes
        return <Navigate to="/informacoes" replace />;
    }

    return <Outlet />;
};

export default ClientAuthGate;
