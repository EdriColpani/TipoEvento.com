import { useQuery } from '@tanstack/react-query';
import { restGetAuthOrPublic } from '@/utils/supabase-rest';

interface UserType {
    id: number;
    nome: string;
}

const LOCAL_TYPE_NAMES: Record<number, string> = {
    1: 'Administrador Master',
    2: 'Gestor',
    3: 'Cliente',
};

const fetchUserTypes = async (): Promise<UserType[]> => {
    try {
        const data = await restGetAuthOrPublic<UserType[]>(
            'tipo_usuario?select=id,nome&order=id.asc',
            8_000,
        );
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn('tipo_usuario failed', e instanceof Error ? e.message : e);
        return [];
    }
};

export const useUserType = (userTypeId: number | undefined) => {
    const { data: userTypes, isLoading, isError } = useQuery({
        queryKey: ['userTypes'],
        queryFn: fetchUserTypes,
        staleTime: Infinity,
        retry: 1,
        placeholderData: [],
        enabled: userTypeId !== undefined,
    });

    const getUserTypeName = (id: number | undefined): string => {
        if (id === undefined) return 'Carregando...';

        const tipo = Number(id);
        if (LOCAL_TYPE_NAMES[tipo]) return LOCAL_TYPE_NAMES[tipo];

        const type = userTypes?.find((t) => Number(t.id) === tipo);
        if (type?.nome) return type.nome;

        if (isLoading) return 'Carregando...';
        return 'Conta EventFest';
    };

    return {
        userTypeName: getUserTypeName(userTypeId),
        isLoadingUserType: isLoading,
        isErrorUserType: isError,
    };
};
