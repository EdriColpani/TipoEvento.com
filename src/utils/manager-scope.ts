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
