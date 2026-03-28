import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';

const NATUREZA_PF = 1;
const TIPO_GESTOR_PRO = 2;

/** Dados mínimos para criar empresa “titular” do gestor PF (endereço vem do perfil). */
export type GestorCompanySource = {
    tipo_usuario_id: number;
    natureza_juridica_id: number | null;
    first_name: string;
    last_name: string;
    cpf: string;
    cep: string;
    rua: string;
    bairro: string;
    cidade: string;
    estado: string;
    numero: string;
    complemento: string | null;
};

/**
 * CNPJ sintético 14 dígitos: prefixo 9 + CPF (11) + sufixo 00.
 * Uso interno para unicidade no banco; não substitui documento fiscal de PJ.
 */
export function buildSyntheticPfCompanyCnpj(cleanCpf11: string): string {
    if (cleanCpf11.length !== 11 || !/^\d{11}$/.test(cleanCpf11)) {
        throw new Error('CPF inválido para vínculo com empresa.');
    }
    return `9${cleanCpf11}00`;
}

/**
 * Garante que o gestor PRO PF tenha `companies` + `user_companies` (is_primary).
 * Idempotente: se já existir empresa principal, retorna o id.
 */
export async function ensureGestorCompanyLinked(
    client: SupabaseClient,
    userId: string,
    source: GestorCompanySource,
): Promise<{ id: string } | null> {
    const existingCompanyId = await fetchManagerPrimaryCompanyId(client, userId);
    if (existingCompanyId) {
        return { id: existingCompanyId };
    }

    // PF explícito, ou natureza ainda NULL no perfil (legado) — permite criar vínculo sintético com CPF.
    // PJ explícito (2) sem user_companies deve cadastrar empresa em Configurações, não inventar CNPJ.
    const tipoOk = Number(source.tipo_usuario_id) === TIPO_GESTOR_PRO;
    const nj = source.natureza_juridica_id;
    const canSynthetic = nj === null || Number(nj) === NATUREZA_PF;

    if (!tipoOk || !canSynthetic) {
        return null;
    }

    const cleanCpf = (source.cpf || '').replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
        return null;
    }

    let syntheticCnpj: string;
    try {
        syntheticCnpj = buildSyntheticPfCompanyCnpj(cleanCpf);
    } catch {
        return null;
    }

    const displayName = `${source.first_name || ''} ${source.last_name || ''}`.trim() || 'Gestor PF';
    const cleanCep = (source.cep || '').replace(/\D/g, '') || null;

    const companyPayload = {
        cnpj: syntheticCnpj,
        corporate_name: `${displayName} (Gestor PF)`,
        trade_name: displayName,
        phone: null as string | null,
        email: null as string | null,
        cep: cleanCep,
        street: source.rua || null,
        number: source.numero || null,
        neighborhood: source.bairro || null,
        city: source.cidade || null,
        state: source.estado || null,
        complement: source.complemento || null,
    };

    const { data: byCnpj } = await client.from('companies').select('id').eq('cnpj', syntheticCnpj).maybeSingle();

    let companyId: string;
    if (byCnpj?.id) {
        companyId = byCnpj.id;
    } else {
        const { data: inserted, error: insErr } = await client
            .from('companies')
            .insert([companyPayload])
            .select('id')
            .single();

        if (insErr) {
            console.error('[ensureGestorCompanyLinked] companies insert', insErr);
            throw new Error(insErr.message);
        }
        companyId = inserted.id;
    }

    const { error: ucErr } = await client.from('user_companies').insert({
        user_id: userId,
        company_id: companyId,
        role: 'owner',
        is_primary: true,
    });

    if (ucErr) {
        if (ucErr.code === '23505') {
            return { id: companyId };
        }
        console.error('[ensureGestorCompanyLinked] user_companies insert', ucErr);
        throw new Error(ucErr.message);
    }

    return { id: companyId };
}
