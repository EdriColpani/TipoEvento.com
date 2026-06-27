import { useEffect, useState } from 'react';
import { ProfileData } from './use-profile';

/**
 * Sinal leve para badge no avatar (perfil incompleto do cliente).
 * Notificações de gestor/admin ficam no NotificationBell (React Query).
 */
export function useProfileStatus(
  profile: ProfileData | undefined,
  isLoadingProfile: boolean,
  userId?: string | null,
) {
  const [hasPendingNotifications, setHasPendingNotifications] = useState(false);

  useEffect(() => {
    if (isLoadingProfile || !profile || !userId) {
      setHasPendingNotifications(false);
      return;
    }

    if (Number(profile.tipo_usuario_id) === 3) {
      const isIncomplete =
        !profile.rg ||
        !profile.rua ||
        !profile.cidade ||
        !profile.estado ||
        !profile.cep;
      setHasPendingNotifications(isIncomplete);
      return;
    }

    setHasPendingNotifications(false);
  }, [profile, isLoadingProfile, userId]);

  return { hasPendingNotifications, loading: false };
}
