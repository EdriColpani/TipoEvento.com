import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { showError } from '@/utils/toast';
import { LOGIN_PATH } from '@/utils/auth-routes';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { ADMIN_MASTER_USER_TYPE_ID } from '@/utils/public-launch-access';
import { restGet } from '@/utils/supabase-rest';

const AdminMasterRouteGuard: React.FC = () => {
    const { userId, sessionReady, profile, profileLoading, tipoUsuarioId } = usePublicSiteAuth();
    const [tipoFromRest, setTipoFromRest] = useState<number | undefined>();

    useEffect(() => {
        if (!userId || tipoUsuarioId || profile?.tipo_usuario_id) return;

        let cancelled = false;
        void restGet<{ tipo_usuario_id: number }[]>(
            `profiles?id=eq.${userId}&select=tipo_usuario_id&limit=1`,
            5_000,
        )
            .then((rows) => {
                const tipo = rows?.[0]?.tipo_usuario_id;
                if (!cancelled && Number.isFinite(tipo) && tipo > 0) {
                    setTipoFromRest(tipo);
                }
            })
            .catch(() => {
                /* REST opcional — useProfile continua em paralelo */
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

    const tipo = Number(tipoUsuarioId ?? tipoFromRest ?? profile?.tipo_usuario_id);
    const tipoKnown = Number.isFinite(tipo) && tipo > 0;

    if (tipoKnown && tipo !== ADMIN_MASTER_USER_TYPE_ID) {
        showError('Acesso negado. Você não tem permissão de Administrador Master.');
        return <Navigate to="/manager/dashboard" replace />;
    }

    if (!tipoKnown && profileLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!tipoKnown && !profileLoading) {
        showError('Acesso negado. Faça login.');
        return <Navigate to={LOGIN_PATH} replace />;
    }

    return <Outlet />;
};

export default AdminMasterRouteGuard;
