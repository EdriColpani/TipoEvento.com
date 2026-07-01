import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';

const PublicLaunchRegistrationGuard: React.FC = () => {
    const { isPreview } = usePublicLaunchMode();

    if (isPreview) {
        return <Navigate to="/informacoes" replace />;
    }

    return <Outlet />;
};

export default PublicLaunchRegistrationGuard;
