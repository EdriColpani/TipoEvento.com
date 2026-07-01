import { supabase } from '@/integrations/supabase/client';

/** Remove tokens locais do Supabase (fallback se signOut não limpar tudo). */
function clearSupabaseAuthStorage(): void {
    try {
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
    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch {
        /* continua limpando storage */
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        try {
            await supabase.auth.signOut();
        } catch {
            clearSupabaseAuthStorage();
        }
    }

    const { data: { session: after } } = await supabase.auth.getSession();
    if (after) {
        clearSupabaseAuthStorage();
    }
}
