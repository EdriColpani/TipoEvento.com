import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';
import { restGet, restPost } from '@/utils/supabase-rest';
import { supabaseAnonKey, supabaseUrl } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';

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

async function insertCompanyReturningId(
    payload: Record<string, unknown>,
    timeoutMs = 12_000,
): Promise<string> {
    const token = readCachedAuthSession().accessToken;
    if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/companies?select=id`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
                Prefer: 'return=representation',
                Accept: 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = (await response.json().catch(() => null)) as
            | { id?: string; message?: string; code?: string }[]
            | { id?: string; message?: string; code?: string }
            | null;

        if (!response.ok) {
            const row = Array.isArray(data) ? data[0] : data;
            throw new Error(row?.message ?? 'Erro ao criar empresa do gestor.');
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.id) {
            throw new Error('Empresa criada sem id retornado.');
        }
        return row.id;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('Tempo esgotado ao criar empresa do gestor.');
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

/**
 * Garante que o gestor PRO PF tenha `companies` + `user_companies` (is_primary).
 * Idempotente: se já existir empresa principal, retorna o id.
 * Usa REST+timeout (evita hang do supabase-js).
 */
export async function ensureGestorCompanyLinked(
    _client: SupabaseClient,
    userId: string,
    source: GestorCompanySource,
): Promise<{ id: string } | null> {
    const existingCompanyId = await fetchManagerPrimaryCompanyIdRest(userId);
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

    const byCnpj = await restGet<{ id: string }[]>(
        `companies?cnpj=eq.${encodeURIComponent(syntheticCnpj)}&select=id&limit=1`,
        10_000,
    );

    let companyId: string;
    if (byCnpj[0]?.id) {
        companyId = byCnpj[0].id;
    } else {
        try {
            companyId = await insertCompanyReturningId(companyPayload);
        } catch (insErr) {
            console.error('[ensureGestorCompanyLinked] companies insert', insErr);
            throw insErr instanceof Error ? insErr : new Error('Falha ao criar empresa.');
        }
    }

    try {
        await restPost(
            'user_companies',
            {
                user_id: userId,
                company_id: companyId,
                role: 'owner',
                is_primary: true,
            },
            12_000,
        );
    } catch (ucErr: unknown) {
        const msg = ucErr instanceof Error ? ucErr.message : String(ucErr);
        if (msg.includes('duplicate') || msg.includes('23505') || msg.toLowerCase().includes('unique')) {
            return { id: companyId };
        }
        console.error('[ensureGestorCompanyLinked] user_companies insert', ucErr);
        throw ucErr instanceof Error ? ucErr : new Error(msg);
    }

    return { id: companyId };
}
