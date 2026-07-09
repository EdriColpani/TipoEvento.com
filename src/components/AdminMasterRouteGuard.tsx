import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { showError } from '@/utils/toast';
import { LOGIN_PATH } from '@/utils/auth-routes';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { ADMIN_MASTER_USER_TYPE_ID } from '@/utils/public-launch-access';
import { fetchProfileTipoUsuarioId, normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';

const AdminMasterRouteGuard: React.FC = () => {
    const { userId, sessionReady, profile, profileLoading, tipoUsuarioId, roleLoading } =
        usePublicSiteAuth();
    const [tipoFromRest, setTipoFromRest] = useState<number | undefined>();

    useEffect(() => {
        if (!userId || tipoUsuarioId || profile?.tipo_usuario_id) return;

        let cancelled = false;
        void fetchProfileTipoUsuarioId(userId).then((tipo) => {
            if (!cancelled && tipo != null) setTipoFromRest(tipo);
        });

        return () => {
            cancelled = true;
        };
    }, [userId, tipoUsuarioId, profile?.tipo_usuario_id]);

    if (!sessionReady) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!userId) {
        showError('Acesso negado. Faça login.');
        return <Navigate to={LOGIN_PATH} replace />;
    }

    const tipo = normalizeTipoUsuarioId(
        tipoUsuarioId ?? tipoFromRest ?? profile?.tipo_usuario_id,
    );
    const tipoKnown = tipo != null;

    if (tipoKnown && tipo !== ADMIN_MASTER_USER_TYPE_ID) {
        showError('Acesso negado. Você não tem permissão de Administrador Master.');
        return <Navigate to="/manager/dashboard" replace />;
    }

    if (!tipoKnown && (profileLoading || roleLoading)) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!tipoKnown && !profileLoading && !roleLoading) {
        showError('Acesso negado. Faça login.');
        return <Navigate to={LOGIN_PATH} replace />;
    }

    return <Outlet />;
};

export default AdminMasterRouteGuard;
