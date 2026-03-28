import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

interface ProfileData {
    first_name: string;
    last_name: string; // Adicionado last_name para consistência
    avatar_url: string | null;
    cpf: string; // Alterado para string, será '' se for null no DB
    rg: string; // Alterado para string, será '' se for null no DB
    birth_date: string; // Alterado para string, será '' se for null no DB
    gender: string; // Alterado para string, será '' se for null no DB
    cep: string; // Alterado para string, será '' se for null no DB
    rua: string; // Alterado para string, será '' se for null no DB
    bairro: string; // Alterado para string, será '' se for null no DB
    cidade: string; // Alterado para string, será '' se for null no DB
    estado: string; // Alterado para string, será '' se for null no DB
    numero: string; // Alterado para string, será '' se for null no DB
    complemento: string; // Alterado para string, será '' se for null no DB
    tipo_usuario_id: number;
    natureza_juridica_id: number | null; // NOVO: Natureza Jurídica (1=PF, 2=PJ)
    public_id: string; // NOVO: Identificador público
    contract_version_accepted_id: string | null;
}

const fetchProfile = async (userId: string): Promise<ProfileData | null> => {
    if (!userId) return null;

    const { data, error } = await supabase
        .from('profiles')
        .select(`
            first_name, last_name, avatar_url, cpf, rg, birth_date, gender, 
            cep, rua, bairro, cidade, estado, numero, complemento,
            tipo_usuario_id, natureza_juridica_id, public_id, contract_version_accepted_id
        `)
        .eq('id', userId)
        .single();

    if (error) {
        console.error("Error fetching profile:", error);
        return null;
    }
    
    // Mapeia dados para garantir que campos que podem ser NULL no DB sejam strings vazias no frontend
    return {
        first_name: data.first_name || '',
        last_name: data.last_name || '', // Mapeando last_name
        avatar_url: data.avatar_url || null,
        cpf: data.cpf || '',
        rg: data.rg || '',
        birth_date: data.birth_date || '',
        gender: data.gender || '',
        cep: data.cep || '',
        rua: data.rua || '',
        bairro: data.bairro || '',
        cidade: data.cidade || '',
        estado: data.estado || '',
        numero: data.numero || '',
        complemento: data.complemento || '',
        tipo_usuario_id: data.tipo_usuario_id,
        natureza_juridica_id: data.natureza_juridica_id, // Mapeando natureza jurídica
        public_id: data.public_id || 'N/A', // Mapeando public_id
        contract_version_accepted_id: data.contract_version_accepted_id ?? null,
    } as ProfileData;
};

export const useProfile = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['profile', userId],
        queryFn: () => fetchProfile(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    return {
        ...query,
        profile: query.data,
        invalidateProfile: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    };
};

export type { ProfileData };