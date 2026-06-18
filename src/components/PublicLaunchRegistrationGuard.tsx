import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';

const PublicLaunchRegistrationGuard: React.FC = () => {
    const { showPreLaunchExperience, isLoading } = usePublicLaunchMode();

    if (isLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-cyan-400 mb-4" />
                <p>Carregando...</p>
            </div>
        );
    }

    if (showPreLaunchExperience) {
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
};

export default PublicLaunchRegistrationGuard;
