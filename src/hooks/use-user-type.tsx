import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface UserType {
    id: number;
    nome: string;
}

const fetchUserTypes = async (): Promise<UserType[]> => {
    try {
        const { data, error } = await supabase
            .from('tipo_usuario')
            .select('id, nome');

        if (error) {
            console.warn('tipo_usuario:', error.message);
            return [];
        }

        return data as UserType[];
    } catch (e) {
        console.warn('tipo_usuario failed', e);
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
        if (id === undefined || !userTypes) return 'Carregando...';

        const tipo = Number(id);
        const type = userTypes.find((t) => Number(t.id) === tipo);
        
        // Mapeamento para nomes mais amigáveis, se necessário
        if (type) {
            if (tipo === 1) return 'Administrador Master';
            if (tipo === 2) return 'Gestor';
            if (tipo === 3) return 'Cliente';
            return type.nome;
        }
        
        return 'Desconhecido';
    };

    return {
        userTypeName: getUserTypeName(userTypeId),
        isLoadingUserType: isLoading,
        isErrorUserType: isError,
    };
};