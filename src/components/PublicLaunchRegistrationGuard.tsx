import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';

const PublicLaunchRegistrationGuard: React.FC = () => {
    const { showPreLaunchExperience } = usePublicLaunchMode();

    if (showPreLaunchExperience) {
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
};

export default PublicLaunchRegistrationGuard;
