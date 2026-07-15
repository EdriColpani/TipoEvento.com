import { useQuery } from '@tanstack/react-query';
import { fetchProfileTipoUsuarioId } from '@/utils/fetch-profile-tipo';

export const PROFILE_TIPO_QUERY_KEY = 'profileTipo' as const;

export function useUserRole(userId: string | undefined) {
    const query = useQuery({
        queryKey: [PROFILE_TIPO_QUERY_KEY, userId],
        queryFn: () => fetchProfileTipoUsuarioId(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
        retry: 2,
        retryDelay: (attempt) => 400 * (attempt + 1),
        refetchOnWindowFocus: false,
    });

    return {
        tipoUsuarioId: query.data ?? undefined,
        isLoading: query.isLoading || query.isFetching,
        isError: query.isError,
        isFetched: query.isFetched,
    };
}
