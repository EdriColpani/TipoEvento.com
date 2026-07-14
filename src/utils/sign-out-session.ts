import { supabase, supabaseUrl } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { withTimeout } from '@/utils/promise-timeout';

export const AUTH_SIGNED_OUT_EVENT = 'eventfest:auth-signed-out';

/** Remove tokens locais do Supabase (não usa getSession — evita deadlock). */
export function clearAuthSessionStorage(): void {
    try {
        const ref = new URL(supabaseUrl).hostname.split('.')[0];
        localStorage.removeItem(`sb-${ref}-auth-token`);
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith('sb-') && key.includes('auth-token')) {
                localStorage.removeItem(key);
            }
        }
    } catch {
        /* ignore */
    }
}

/**
 * Limpa a sessão só se o JWT que falhou (401) ainda for o da sessão atual.
 * Evita que uma requisição antiga com token expirado apague um login recém-feito.
 */
export function clearAuthSessionIfCurrentToken(failedAccessToken: string | null | undefined): boolean {
    if (!failedAccessToken) return false;
    const current = readCachedAuthSession().accessToken;
    if (!current || current !== failedAccessToken) {
        return false;
    }
    clearAuthSessionStorage();
    return true;
}

function notifySignedOut(): void {
    window.dispatchEvent(new CustomEvent(AUTH_SIGNED_OUT_EVENT));
}

/** Encerra sessão local de forma confiável (gestor, cliente, admin). */
export async function signOutSession(): Promise<void> {
    await withTimeout(
        supabase.auth.signOut({ scope: 'local' }).catch(() => undefined),
        4_000,
        undefined,
    );

    clearAuthSessionStorage();
    notifySignedOut();
}
