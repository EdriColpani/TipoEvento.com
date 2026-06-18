import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';
import { isPublicLaunchRestrictedPath } from '@/utils/public-launch-access';

const PublicLaunchRouteGuard: React.FC = () => {
    const location = useLocation();
    const { showPreLaunchExperience, isLoading } = usePublicLaunchMode();

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-cyan-400 mb-4" />
                <p>Carregando...</p>
            </div>
        );
    }

    if (showPreLaunchExperience && isPublicLaunchRestrictedPath(location.pathname)) {
        return <Navigate to="/" replace state={{ from: location.pathname }} />;
    }

    return <Outlet />;
};

export default PublicLaunchRouteGuard;
