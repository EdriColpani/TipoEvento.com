import { useQuery, useQueryClient } from '@tanstack/react-query';
import { withTimeout } from '@/utils/promise-timeout';
import { restGet } from '@/utils/supabase-rest';
import { normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';
import { readCachedAuthSession } from '@/utils/auth-session-cache';

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
            5_000,
        );
        const row = rows[0];
        if (row) return mapRestRow(row);
    } catch (restError) {
        if (!readCachedAuthSession().accessToken) return null;
        console.warn('[useProfile] REST full falhou, tentando select mínimo:', restError);
        try {
            const rows = await restGet<Record<string, unknown>[]>(
                `profiles?id=eq.${idEq}&select=${REST_MINIMAL_SELECT}&limit=1`,
                3_000,
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
            console.warn('[useProfile] REST mínimo falhou:', minimalRestError);
        }
    }

    if (!readCachedAuthSession().accessToken) {
        return null;
    }

    return null;
};

export const useProfile = (userId: string | undefined) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['profile', userId],
        queryFn: async () => {
            const result = await withTimeout(fetchProfile(userId!), 6_000, null);
            return result;
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
        retry: 0,
        refetchOnWindowFocus: false,
    });

    return {
        ...query,
        profile: query.data,
        invalidateProfile: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
    };
};

export type { ProfileData };