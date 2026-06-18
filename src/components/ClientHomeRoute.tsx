import React from 'react';
import { Loader2 } from 'lucide-react';
import Index from '@/pages/Index';
import PreLaunchPage from '@/pages/PreLaunchPage';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';

const ClientHomeRoute: React.FC = () => {
    const { showPreLaunchExperience, isLoading } = usePublicLaunchMode();

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-cyan-400 mb-4" />
                <p>Carregando...</p>
            </div>
        );
    }

    if (showPreLaunchExperience) {
        return <PreLaunchPage />;
    }

    return <Index />;
};

export default ClientHomeRoute;
