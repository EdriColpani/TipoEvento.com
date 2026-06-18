import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';
import { isPublicLaunchRestrictedPath } from '@/utils/public-launch-access';

const PublicLaunchRouteGuard: React.FC = () => {
    const location = useLocation();
    const { showPreLaunchExperience } = usePublicLaunchMode();

    if (showPreLaunchExperience && isPublicLaunchRestrictedPath(location.pathname)) {
        return <Navigate to="/" replace state={{ from: location.pathname }} />;
    }

    return <Outlet />;
};

export default PublicLaunchRouteGuard;
