import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ProfileData } from './use-profile';
import { fetchManagerNotifications } from '@/hooks/use-manager-notifications';

interface UseProfileStatusReturn {
    hasPendingNotifications: boolean;
    loading: boolean;
}

/**
 * Hook para verificar o status do perfil e notificações pendentes
 *
 * Clientes (tipo 3): perfil incompleto para cadastro PRO.
 * Gestores (tipo 1 ou 2): alertas reais (ex.: estoque baixo em eventos).
 */
export const useProfileStatus = (
    profile: ProfileData | null | undefined,
    isLoadingProfile: boolean,
): UseProfileStatusReturn => {
    const [userId, setUserId] = useState<string | null>(null);
    const [hasPendingNotifications, setHasPendingNotifications] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUserId(session?.user?.id || null);
        });
    }, []);

    useEffect(() => {
        if (isLoadingProfile) {
            setLoading(true);
            return;
        }

        if (!profile || !userId) {
            setHasPendingNotifications(false);
            setLoading(false);
            return;
        }

        const checkStatus = async () => {
            try {
                if (profile.tipo_usuario_id === 3) {
                    const isIncomplete =
                        !profile.rg ||
                        !profile.rua ||
                        !profile.cidade ||
                        !profile.estado ||
                        !profile.cep;
                    setHasPendingNotifications(isIncomplete);
                } else if (profile.tipo_usuario_id === 1 || profile.tipo_usuario_id === 2) {
                    const notifications = await fetchManagerNotifications(userId);
                    setHasPendingNotifications(notifications.length > 0);
                } else {
                    setHasPendingNotifications(false);
                }
            } catch (error) {
                console.error('Erro ao verificar status do perfil:', error);
                setHasPendingNotifications(false);
            } finally {
                setLoading(false);
            }
        };

        checkStatus();
    }, [profile, isLoadingProfile, userId]);

    return {
        hasPendingNotifications,
        loading,
    };
};
