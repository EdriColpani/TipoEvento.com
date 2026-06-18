import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

interface UserType {
    id: number;
    nome: string;
}

const fetchUserTypes = async (): Promise<UserType[]> => {
    // A política RLS permite que usuários autenticados leiam esta tabela
    const { data, error } = await supabase
        .from('tipo_usuario')
        .select('id, nome');

    if (error) {
        console.error("Error fetching user types:", error);
        throw new Error(error.message);
    }
    
    return data as UserType[];
};

export const useUserType = (userTypeId: number | undefined) => {
    const { data: userTypes, isLoading, isError } = useQuery({
        queryKey: ['userTypes'],
        queryFn: fetchUserTypes,
        staleTime: Infinity, // Tipos de usuário raramente mudam
        onError: (error) => {
            console.error("Query Error: Failed to load user types.", error);
            // Não exibimos um toast de erro aqui, pois é um dado de fundo
        }
    });

    const getUserTypeName = (id: number | undefined): string => {
        if (id === undefined || !userTypes) return 'Carregando...';
        
        const type = userTypes.find(t => t.id === id);
        
        // Mapeamento para nomes mais amigáveis, se necessário
        if (type) {
            if (type.id === 1) return 'Administrador Master';
            if (type.id === 2) return 'Gestor';
            if (type.id === 3) return 'Cliente';
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