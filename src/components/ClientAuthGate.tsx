import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { isGuestAllowedPath } from '@/utils/public-launch-access';
import { isStaffUserType, resolveRoleHomePath } from '@/utils/role-home-path';

const PUBLIC_HOME_PATHS = new Set(['/', '/informacoes']);

const ClientAuthGate: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [redirecting, setRedirecting] = useState(false);
    const {
        sessionReady,
        isAuthenticated,
        userId,
        tipoUsuarioId,
        roleLoading,
    } = usePublicSiteAuth();

    useEffect(() => {
        if (!sessionReady || roleLoading || !isAuthenticated || !userId || tipoUsuarioId == null) {
            setRedirecting(false);
            return;
        }

        const path = location.pathname;

        if (path === '/informacoes' && tipoUsuarioId === 3) {
            navigate('/', { replace: true });
            return;
        }

        if (PUBLIC_HOME_PATHS.has(path) && isStaffUserType(tipoUsuarioId)) {
            setRedirecting(true);
            void resolveRoleHomePath(userId, tipoUsuarioId).then((target) => {
                if (target !== path) {
                    navigate(target, { replace: true });
                } else {
                    setRedirecting(false);
                }
            });
            return;
        }

        setRedirecting(false);
    }, [
        isAuthenticated,
        location.pathname,
        navigate,
        roleLoading,
        sessionReady,
        tipoUsuarioId,
        userId,
    ]);

    if (!sessionReady || (isAuthenticated && roleLoading && PUBLIC_HOME_PATHS.has(location.pathname))) {
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
