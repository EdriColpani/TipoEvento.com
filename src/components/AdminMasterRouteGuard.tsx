import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { showError } from '@/utils/toast';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminMasterRouteGuard: React.FC = () => {
    const [userId, setUserId] = React.useState<string | undefined>(undefined);
    const [loadingSession, setLoadingSession] = React.useState(true);

    React.useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
            setLoadingSession(false);
        });
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);

    if (loadingSession || isLoadingProfile) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    // 1. Check if logged in
    if (!userId || !profile) {
        showError("Acesso negado. Faça login.");
        return <Navigate to="/manager/login" replace />;
    }

    // 2. Check if user is Admin Master (tipo_usuario_id = 1); Number() evita falha se vier como string do DB
    if (Number(profile.tipo_usuario_id) !== ADMIN_MASTER_USER_TYPE_ID) {
        showError("Acesso negado. Você não tem permissão de Administrador Master.");
        
        // Redirect non-admin masters to the manager dashboard
        return <Navigate to="/manager/dashboard" replace />;
    }

    // If authenticated and is Admin Master, render the nested route
    return <Outlet />;
};

export default AdminMasterRouteGuard;