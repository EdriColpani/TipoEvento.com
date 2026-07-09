import { useQuery } from '@tanstack/react-query';
import { fetchProfileTipoUsuarioId } from '@/utils/fetch-profile-tipo';

export const PROFILE_TIPO_QUERY_KEY = 'profileTipo' as const;

export function useUserRole(userId: string | undefined) {
    const query = useQuery({
        queryKey: [PROFILE_TIPO_QUERY_KEY, userId],
        queryFn: () => fetchProfileTipoUsuarioId(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
        retry: 3,
        refetchOnWindowFocus: false,
    });

    return {
        tipoUsuarioId: query.data ?? undefined,
        isLoading: query.isLoading,
        isError: query.isError,
        isFetched: query.isFetched,
    };
}
