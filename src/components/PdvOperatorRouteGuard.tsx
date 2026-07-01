import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useManagerCompanyContext } from '@/hooks/use-manager-company-context';

const PDV_OPERATOR_ALLOWED_PREFIXES = [
    '/manager/credit/pdv',
    '/manager/credit/establishments',
    '/manager/settings/individual-profile',
];

interface PdvOperatorRouteGuardProps {
    userId?: string;
    children: React.ReactNode;
}

const PdvOperatorRouteGuard: React.FC<PdvOperatorRouteGuardProps> = ({ userId, children }) => {
    const location = useLocation();
    const { context, isLoading } = useManagerCompanyContext(userId);

    if (!userId || isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mb-3" />
                <p>Carregando permissões...</p>
            </div>
        );
    }

    if (!context?.isPdvOperator) {
        return <>{children}</>;
    }

    const allowed = PDV_OPERATOR_ALLOWED_PREFIXES.some((prefix) =>
        location.pathname.startsWith(prefix),
    );

    if (!allowed) {
        return <Navigate to="/manager/credit/pdv" replace />;
    }

    return <>{children}</>;
};

export default PdvOperatorRouteGuard;
