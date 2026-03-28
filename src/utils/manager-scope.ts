import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve `company_id` do gestor a partir de `user_companies`.
 * - Prioriza vínculo com `is_primary === true`.
 * - Se nenhum estiver marcado como principal (legado / dados antigos), usa qualquer vínculo do usuário.
 * Evita depender só de `is_primary` e de `.single()` com join (que pode gerar 406 / PGRST116 indevidos).
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
