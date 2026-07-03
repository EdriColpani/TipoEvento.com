import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { showError } from '@/utils/toast';
import { LOGIN_PATH } from '@/utils/auth-routes';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { ADMIN_MASTER_USER_TYPE_ID } from '@/utils/public-launch-access';

const AdminMasterRouteGuard: React.FC = () => {
    const { userId, sessionReady, profile, profileLoading, tipoUsuarioId } = usePublicSiteAuth();

    if (!sessionReady || (profileLoading && !profile)) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!userId || !profile) {
        showError('Acesso negado. Faça login.');
        return <Navigate to={LOGIN_PATH} replace />;
    }

    if (Number(tipoUsuarioId ?? profile.tipo_usuario_id) !== ADMIN_MASTER_USER_TYPE_ID) {
        showError('Acesso negado. Você não tem permissão de Administrador Master.');
        return <Navigate to="/manager/dashboard" replace />;
    }

    return <Outlet />;
};

export default AdminMasterRouteGuard;
