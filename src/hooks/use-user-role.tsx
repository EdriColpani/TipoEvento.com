import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

async function fetchUserRole(userId: string): Promise<number | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('tipo_usuario_id')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('[useUserRole]', error.message);
        return null;
    }

    const tipo = Number(data?.tipo_usuario_id);
    return Number.isFinite(tipo) ? tipo : null;
}

export function useUserRole(userId: string | undefined) {
    const query = useQuery({
        queryKey: ['userRole', userId],
        queryFn: () => fetchUserRole(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
        retry: 2,
    });

    return {
        tipoUsuarioId: query.data ?? undefined,
        isLoading: query.isLoading,
        isError: query.isError,
    };
}
