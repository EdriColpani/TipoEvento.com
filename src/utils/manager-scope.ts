import type { SupabaseClient } from '@supabase/supabase-js';
import { restGet } from '@/utils/supabase-rest';

type UserCompanyLink = { company_id: string | null; is_primary: boolean | null };

function pickPrimaryCompanyId(rows: UserCompanyLink[]): string | null {
    const primary = rows.find((r) => r.is_primary === true && r.company_id);
    if (primary?.company_id) return primary.company_id;
    const first = rows.find((r) => r.company_id != null);
    return first?.company_id ?? null;
}

/** Resolve company_id via REST (rápido; evita deadlock do supabase-js). */
export async function fetchManagerPrimaryCompanyIdRest(userId: string): Promise<string | null> {
    const rows = await restGet<UserCompanyLink[]>(
        `user_companies?user_id=eq.${userId}&select=company_id,is_primary`,
        8_000,
    );
    if (!rows?.length) return null;
    return pickPrimaryCompanyId(rows);
}

/**
 * Resolve `company_id` do gestor a partir de `user_companies`.
 * - Prioriza vínculo com `is_primary === true`.
 * - Se nenhum estiver marcado como principal (legado / dados antigos), usa qualquer vínculo do usuário.
 */
export async function fetchManagerPrimaryCompanyId(
    client: SupabaseClient,
    userId: string,
): Promise<string | null> {
    const { data: rows, error } = await client
        .from('user_companies')
        .select('company_id, is_primary')
        .eq('user_id', userId);

    if (error && error.code !== 'PGRST116') {
        console.error('[fetchManagerPrimaryCompanyId]', error);
        throw new Error(error.message);
    }

    if (!rows?.length) {
        return null;
    }

    const primary = rows.find((r) => r.is_primary === true);
    if (primary?.company_id) {
        return primary.company_id;
    }

    const first = rows.find((r) => r.company_id != null);
    return first?.company_id ?? null;
}

/**
 * E-mail da empresa principal para notificações (`companies.email`), resolvido via `user_companies`.
 * Retorna `null` se não houver vínculo, empresa sem linha legível ou e-mail vazio/só espaços.
 */
export async function fetchManagerCompanyNotificationEmail(
    client: SupabaseClient,
    userId: string,
): Promise<string | null> {
    const companyId = await fetchManagerPrimaryCompanyId(client, userId);
    if (!companyId) {
        return null;
    }

    const { data: row, error } = await client
        .from('companies')
        .select('email')
        .eq('id', companyId)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        console.error('[fetchManagerCompanyNotificationEmail]', error);
    }

    const raw = row?.email;
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** Versão REST — evita hang do supabase-js na tela de notificações. */
export async function fetchManagerCompanyNotificationEmailRest(
    userId: string,
): Promise<string | null> {
    const companyId = await fetchManagerPrimaryCompanyIdRest(userId);
    if (!companyId) return null;

    const rows = await restGet<{ email?: string | null }[]>(
        `companies?id=eq.${encodeURIComponent(companyId)}&select=email&limit=1`,
        8_000,
    );
    const raw = rows?.[0]?.email;
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** Todas as empresas vinculadas ao usuário (não só a principal). */
export async function fetchManagerCompanyIds(
    client: SupabaseClient,
    userId: string,
): Promise<string[]> {
    const { data: rows, error } = await client
        .from('user_companies')
        .select('company_id')
        .eq('user_id', userId);

    if (error && error.code !== 'PGRST116') {
        console.error('[fetchManagerCompanyIds]', error);
        throw new Error(error.message);
    }

    const ids = (rows ?? [])
        .map((r) => r.company_id)
        .filter((id): id is string => id != null && id !== '');
    return [...new Set(ids)];
}
