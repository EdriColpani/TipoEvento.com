import { supabaseUrl } from '@/integrations/supabase/client';

export type CachedAuthSession = {
    userId?: string;
    userEmail?: string;
    accessToken?: string;
};

/** Lê sessão do localStorage (instantâneo — evita tela preta enquanto getSession trava). */
export function readCachedAuthSession(): CachedAuthSession {
    try {
        const ref = new URL(supabaseUrl).hostname.split('.')[0];
        const raw = localStorage.getItem(`sb-${ref}-auth-token`);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as {
            access_token?: string;
            user?: { id?: string; email?: string | null };
        };
        return {
            userId: parsed.user?.id,
            userEmail: parsed.user?.email ?? undefined,
            accessToken: parsed.access_token,
        };
    } catch {
        return {};
    }
}
