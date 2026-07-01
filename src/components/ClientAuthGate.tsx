import React from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { isGuestAllowedPath } from '@/utils/public-launch-access';

const ClientAuthGate: React.FC = () => {
    const location = useLocation();
    const { sessionReady, isAuthenticated } = usePublicSiteAuth();

    if (!sessionReady) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center bg-black px-4">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                <p className="mt-4 text-sm text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (isAuthenticated && location.pathname === '/informacoes') {
        return <Navigate to="/" replace />;
    }

    if (!isAuthenticated) {
        if (location.pathname === '/' || !isGuestAllowedPath(location.pathname)) {
            return <Navigate to="/informacoes" replace state={{ from: location.pathname }} />;
        }
    }

    return <Outlet />;
};

export default ClientAuthGate;
