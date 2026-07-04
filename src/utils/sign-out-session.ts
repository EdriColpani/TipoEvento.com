import { supabase, supabaseUrl } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promise-timeout';

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

/** Encerra sessão local de forma confiável (gestor, cliente, admin). */
export async function signOutSession(): Promise<void> {
    clearAuthSessionStorage();

    await withTimeout(
        supabase.auth.signOut({ scope: 'local' }).catch(() => undefined),
        4_000,
        undefined,
    );

    clearAuthSessionStorage();
}
