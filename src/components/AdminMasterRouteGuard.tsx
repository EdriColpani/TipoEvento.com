import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LOGIN_PATH } from '@/utils/auth-routes';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import { ADMIN_MASTER_USER_TYPE_ID } from '@/utils/public-launch-access';
import {
    fetchProfileTipoUsuarioIdResilient,
    normalizeTipoUsuarioId,
} from '@/utils/fetch-profile-tipo';
import { signOutSession } from '@/utils/sign-out-session';

/**
 * Protege rotas Admin Master.
 * Nunca trata sessão autenticada + perfil lento/falho como "não logado"
 * (isso gerava loop /login com menu de usuário ainda visível).
 */
const AdminMasterRouteGuard: React.FC = () => {
    const { userId, sessionReady, profile, profileLoading, tipoUsuarioId, roleLoading } =
        usePublicSiteAuth();
    const [tipoResolved, setTipoResolved] = useState<number | undefined>();
    const [checkingTipo, setCheckingTipo] = useState(false);
    const [tipoCheckFailed, setTipoCheckFailed] = useState(false);

    const tipo = normalizeTipoUsuarioId(
        tipoUsuarioId ?? tipoResolved ?? profile?.tipo_usuario_id,
    );

    useEffect(() => {
        if (!sessionReady || !userId || tipo != null || profileLoading || roleLoading) {
            return;
        }

        let cancelled = false;
        setCheckingTipo(true);
        setTipoCheckFailed(false);

        void (async () => {
            const fetched = await fetchProfileTipoUsuarioIdResilient(userId);
            if (cancelled) return;
            if (fetched != null) {
                setTipoResolved(fetched);
                setTipoCheckFailed(false);
            } else {
                setTipoCheckFailed(true);
            }
            setCheckingTipo(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [sessionReady, userId, tipo, profileLoading, roleLoading]);

    if (!sessionReady || (userId && (profileLoading || roleLoading || checkingTipo) && tipo == null)) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!userId) {
        // Sem toast: a tela de login já deixa o estado claro.
        return <Navigate to={LOGIN_PATH} replace />;
    }

    if (tipo == null && tipoCheckFailed) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4 px-4 text-center">
                <p className="text-gray-300 max-w-md">
                    Não foi possível carregar suas permissões. Você continua autenticado — tente de novo ou
                    saia e entre outra vez.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                    <Button
                        type="button"
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                        onClick={() => {
                            setTipoCheckFailed(false);
                            setCheckingTipo(true);
                            void fetchProfileTipoUsuarioIdResilient(userId).then((fetched) => {
                                if (fetched != null) {
                                    setTipoResolved(fetched);
                                    setTipoCheckFailed(false);
                                } else {
                                    setTipoCheckFailed(true);
                                }
                                setCheckingTipo(false);
                            });
                        }}
                    >
                        Tentar novamente
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        onClick={() =>
                            void signOutSession().then(() => {
                                window.location.assign(LOGIN_PATH);
                            })
                        }
                    >
                        Sair e entrar de novo
                    </Button>
                </div>
            </div>
        );
    }

    if (tipo == null) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (tipo !== ADMIN_MASTER_USER_TYPE_ID) {
        return <Navigate to="/manager/dashboard" replace />;
    }

    return <Outlet />;
};

export default AdminMasterRouteGuard;
