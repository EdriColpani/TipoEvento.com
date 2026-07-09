import { supabase } from '@/integrations/supabase/client';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';

/** Normaliza tipo_usuario_id vindo de REST/PostgREST (number | string). */
export function normalizeTipoUsuarioId(value: unknown): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
}

/**
 * Leitura mínima e confiável do papel do usuário.
 * Separada do fetch completo de perfil (campos extras / document schema) para
 * não bloquear redirect do gestor nem o menu Dashboard.
 */
export async function fetchProfileTipoUsuarioId(userId: string): Promise<number | undefined> {
    if (!userId) return undefined;

    try {
        const rows = await restGet<{ tipo_usuario_id: number | string }[]>(
            `profiles?id=eq.${encodeURIComponent(userId)}&select=tipo_usuario_id&limit=1`,
            5_000,
        );
        const tipo = normalizeTipoUsuarioId(rows?.[0]?.tipo_usuario_id);
        if (tipo != null) return tipo;
    } catch (restError) {
        console.warn('[fetchProfileTipoUsuarioId] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.from('profiles').select('tipo_usuario_id').eq('id', userId).maybeSingle(),
        5_000,
        { data: null, error: { message: 'timeout' } as { message: string } },
    );

    if (error) {
        console.warn('[fetchProfileTipoUsuarioId] client falhou:', error.message);
        return undefined;
    }

    return normalizeTipoUsuarioId(data?.tipo_usuario_id);
}
