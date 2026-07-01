import React from 'react';
import Index from '@/pages/Index';

/** Home vitrine — só alcançável com usuário logado (ClientAuthGate). */
const ClientHomeRoute: React.FC = () => {
    return <Index />;
};

export default ClientHomeRoute;
