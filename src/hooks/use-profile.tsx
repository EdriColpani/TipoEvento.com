import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promise-timeout';
import { restGet } from '@/utils/supabase-rest';
import { normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';

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

const mapRestRow = (row: Record<string, unknown>): ProfileData => ({
    first_name: String(row.first_name || ''),
    last_name: String(row.last_name || ''),
    avatar_url: (row.avatar_url as string | null) || null,
    cpf: String(row.cpf || ''),
    rg: String(row.rg || ''),
    birth_date: String(row.birth_date || ''),
    gender: String(row.gender || ''),
    cep: String(row.cep || ''),
    rua: String(row.rua || ''),
    bairro: String(row.bairro || ''),
    cidade: String(row.cidade || ''),
    estado: String(row.estado || ''),
    numero: String(row.numero || ''),
    complemento: String(row.complemento || ''),
    tipo_usuario_id: normalizeTipoUsuarioId(row.tipo_usuario_id) ?? 0,
    natureza_juridica_id: (row.natureza_juridica_id as number | null) ?? null,
    public_id: String(row.public_id || 'N/A'),
    contract_version_accepted_id: (row.contract_version_accepted_id as string | null) ?? null,
});

const REST_FULL_SELECT =
    'first_name,last_name,avatar_url,tipo_usuario_id,natureza_juridica_id,public_id,cpf,rg,birth_date,gender,cep,rua,bairro,cidade,estado,numero,complemento,contract_version_accepted_id';
const REST_MINIMAL_SELECT =
    'first_name,last_name,avatar_url,tipo_usuario_id,natureza_juridica_id,public_id';

const fetchProfile = async (userId: string): Promise<ProfileData | null> => {
    if (!userId) return null;
    const idEq = encodeURIComponent(userId);

    try {
        const rows = await restGet<Record<string, unknown>[]>(
            `profiles?id=eq.${idEq}&select=${REST_FULL_SELECT}&limit=1`,
            8_000,
        );
        const row = rows[0];
        if (row) return mapRestRow(row);
    } catch (restError) {
        console.warn('[useProfile] REST full falhou, tentando select mínimo:', restError);
        try {
            const rows = await restGet<Record<string, unknown>[]>(
                `profiles?id=eq.${idEq}&select=${REST_MINIMAL_SELECT}&limit=1`,
                5_000,
            );
            const row = rows[0];
            if (row) {
                return mapRestRow({
                    ...row,
                    cpf: '',
                    rg: '',
                    birth_date: '',
                    gender: '',
                    cep: '',
                    rua: '',
                    bairro: '',
                    cidade: '',
                    estado: '',
                    numero: '',
                    complemento: '',
                    contract_version_accepted_id: null,
                });
            }
        } catch (minimalRestError) {
            console.warn('[useProfile] REST mínimo falhou, tentando supabase client:', minimalRestError);
        }
    }

    const fullSelect = `
            first_name, last_name, avatar_url, cpf, rg, birth_date, gender, 
            cep, rua, bairro, cidade, estado, numero, complemento,
            tipo_usuario_id, natureza_juridica_id, public_id, contract_version_accepted_id
        `;

    const { data, error } = await supabase
        .from('profiles')
        .select(fullSelect)
        .eq('id', userId)
        .single();

    let row = data;

    if (error) {
        console.warn('Error fetching full profile, trying minimal select:', error.message);
        const { data: minimal, error: minimalError } = await supabase
            .from('profiles')
            .select('first_name, last_name, avatar_url, tipo_usuario_id, natureza_juridica_id, public_id')
            .eq('id', userId)
            .single();

        if (minimalError || !minimal) {
            console.error('Error fetching profile:', minimalError ?? error);
            return null;
        }
        row = {
            ...minimal,
            cpf: '',
            rg: '',
            birth_date: '',
            gender: '',
            cep: '',
            rua: '',
            bairro: '',
            cidade: '',
            estado: '',
            numero: '',
            complemento: '',
            contract_version_accepted_id: null,
        };
    }

    if (!row) return null;

    return {
        first_name: row.first_name || '',
        last_name: row.last_name || '',
        avatar_url: row.avatar_url || null,
        cpf: row.cpf || '',
        rg: row.rg || '',
        birth_date: row.birth_date || '',
        gender: row.gender || '',
        cep: row.cep || '',
        rua: row.rua || '',
        bairro: row.bairro || '',
        cidade: row.cidade || '',
        estado: row.estado || '',
        numero: row.numero || '',
        complemento: row.complemento || '',
        tipo_usuario_id: normalizeTipoUsuarioId(row.tipo_usuario_id) ?? 0,
        natureza_juridica_id: row.natureza_juridica_id,
        public_id: row.public_id || 'N/A',
        contract_version_accepted_id: row.contract_version_accepted_id ?? null,
    } as ProfileData;
};

export const useProfile = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['profile', userId],
        queryFn: async () => {
            const result = await withTimeout(fetchProfile(userId!), 12_000, undefined);
            // Timeout não deve virar "perfil inexistente" cacheado (quebra menu do gestor).
            if (result === undefined) {
                throw new Error('PROFILE_FETCH_TIMEOUT');
            }
            return result;
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
        retry: 2,
    });

    return {
        ...query,
        profile: query.data,
        invalidateProfile: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    };
};

export type { ProfileData };