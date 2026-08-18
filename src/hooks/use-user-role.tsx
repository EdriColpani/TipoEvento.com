import { useQuery, type QueryClient } from '@tanstack/react-query';
import { fetchProfileTipoUsuarioId } from '@/utils/fetch-profile-tipo';

export const PROFILE_TIPO_QUERY_KEY = 'profileTipo' as const;

/** Cache do tipo usado no menu do avatar. Deve ir junto com o perfil ao promover cliente → gestor. */
export function applyCachedProfileTipo(
    queryClient: QueryClient,
    userId: string | undefined,
    tipoUsuarioId: number,
) {
    if (!userId) return;
    queryClient.setQueryData([PROFILE_TIPO_QUERY_KEY, userId], tipoUsuarioId);
}

export function invalidateProfileRoleQueries(queryClient: QueryClient, userId: string | undefined) {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    queryClient.invalidateQueries({ queryKey: [PROFILE_TIPO_QUERY_KEY, userId] });
}

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
