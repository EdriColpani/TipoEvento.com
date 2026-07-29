import { useQueryClient } from '@tanstack/react-query';
import { usePublicLaunchModeContext } from '@/contexts/PublicLaunchModeContext';
import {
    PUBLIC_LAUNCH_MODE_QUERY_KEY,
    fetchPublicLaunchMode,
} from '@/utils/public-launch-mode-query';

export { PUBLIC_LAUNCH_MODE_QUERY_KEY, fetchPublicLaunchMode };

/** Lê o modo pré-lançamento do provider global (uma única consulta por sessão). */
export function usePublicLaunchMode() {
    return usePublicLaunchModeContext();
}

export function useInvalidatePublicLaunchMode() {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: [...PUBLIC_LAUNCH_MODE_QUERY_KEY] });
}
