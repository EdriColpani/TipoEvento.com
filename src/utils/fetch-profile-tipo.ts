import { restGet } from '@/utils/supabase-rest';
import { readCachedAuthSession } from '@/utils/auth-session-cache';

/** Normaliza tipo_usuario_id vindo de REST/PostgREST (number | string). */
export function normalizeTipoUsuarioId(value: unknown): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Leitura mínima do papel do usuário — só REST, sem fallback supabase-js (evita deadlock).
 * Retorna null quando indisponível (React Query não aceita undefined).
 */
export async function fetchProfileTipoUsuarioId(
    userId: string,
    timeoutMs = 8_000,
): Promise<number | null> {
    if (!userId) return null;
    if (!readCachedAuthSession().accessToken) return null;

    try {
        const rows = await restGet<{ tipo_usuario_id: number | string }[]>(
            `profiles?id=eq.${encodeURIComponent(userId)}&select=tipo_usuario_id&limit=1`,
            timeoutMs,
        );
        const tipo = normalizeTipoUsuarioId(rows?.[0]?.tipo_usuario_id);
        return tipo ?? null;
    } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        const message = error instanceof Error ? error.message : String(error);
        // Timeout/rede: silencioso em warn curto — evita poluir console com stack
        console.warn(
            '[fetchProfileTipoUsuarioId] falhou:',
            aborted ? 'timeout' : message,
        );
        return null;
    }
}

/** Pós-login: tenta até 3 vezes com timeout maior antes de falhar. */
export async function fetchProfileTipoUsuarioIdResilient(
    userId: string,
): Promise<number | null> {
    const attempts = [10_000, 12_000, 15_000];
    for (let i = 0; i < attempts.length; i++) {
        if (!readCachedAuthSession().accessToken) return null;
        const tipo = await fetchProfileTipoUsuarioId(userId, attempts[i]);
        if (tipo != null) return tipo;
        if (i < attempts.length - 1) {
            await sleep(400 * (i + 1));
        }
    }
    return null;
}
