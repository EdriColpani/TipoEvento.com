import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { LOGIN_PATH } from '@/utils/auth-routes';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';

const ADMIN_USER_TYPE_ID = 1;

/** Sem toast no render; perfil lento ≠ sessão inválida. */
const AdminRouteGuard: React.FC = () => {
    const { userId, sessionReady, profile, profileLoading, tipoUsuarioId, roleLoading } =
        usePublicSiteAuth();

    const tipo = Number(tipoUsuarioId ?? profile?.tipo_usuario_id);
    const tipoKnown = Number.isFinite(tipo) && tipo > 0;

    if (!sessionReady || (userId && !tipoKnown && (profileLoading || roleLoading))) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!userId) {
        return <Navigate to={LOGIN_PATH} replace />;
    }

    if (!tipoKnown) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (tipo !== ADMIN_USER_TYPE_ID) {
        if (tipo === 2) {
            return <Navigate to="/manager/dashboard" replace />;
        }
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
};

export default AdminRouteGuard;
