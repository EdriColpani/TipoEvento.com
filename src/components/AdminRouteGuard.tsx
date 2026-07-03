import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { showError } from '@/utils/toast';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';

const ADMIN_USER_TYPE_ID = 1;

const AdminRouteGuard: React.FC = () => {
    const { userId, sessionReady, profile, profileLoading } = usePublicSiteAuth();

    if (!sessionReady || (profileLoading && !profile)) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!userId || !profile) {
        showError('Acesso negado. Faça login.');
        return <Navigate to="/login" replace />;
    }

    if (profile.tipo_usuario_id !== ADMIN_USER_TYPE_ID) {
        showError('Acesso negado. Você não tem permissão de Administrador.');
        if (profile.tipo_usuario_id === 2) {
            return <Navigate to="/manager/dashboard" replace />;
        }
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
};

export default AdminRouteGuard;
