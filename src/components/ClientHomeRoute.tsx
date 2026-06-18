import React from 'react';
import Index from '@/pages/Index';
import PreLaunchPage from '@/pages/PreLaunchPage';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';

const ClientHomeRoute: React.FC = () => {
    const { showPreLaunchExperience } = usePublicLaunchMode();

    if (showPreLaunchExperience) {
        return <PreLaunchPage />;
    }

    return <Index />;
};

export default ClientHomeRoute;
