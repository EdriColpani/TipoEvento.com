import { restGet } from '@/utils/supabase-rest';
import { readCachedAuthSession } from '@/utils/auth-session-cache';

/** Normaliza tipo_usuario_id vindo de REST/PostgREST (number | string). */
export function normalizeTipoUsuarioId(value: unknown): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
}

/**
 * Leitura mínima do papel do usuário — só REST, sem fallback supabase-js (evita deadlock).
 * Retorna null quando indisponível (React Query não aceita undefined).
 */
export async function fetchProfileTipoUsuarioId(userId: string): Promise<number | null> {
    if (!userId) return null;
    if (!readCachedAuthSession().accessToken) return null;

    try {
        const rows = await restGet<{ tipo_usuario_id: number | string }[]>(
            `profiles?id=eq.${encodeURIComponent(userId)}&select=tipo_usuario_id&limit=1`,
            4_000,
        );
        const tipo = normalizeTipoUsuarioId(rows?.[0]?.tipo_usuario_id);
        return tipo ?? null;
    } catch (error) {
        console.warn('[fetchProfileTipoUsuarioId] falhou:', error);
        return null;
    }
}
