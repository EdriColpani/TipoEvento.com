import { supabaseUrl } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export const AUTH_SIGNED_IN_EVENT = 'eventfest:auth-signed-in';

export type CachedAuthSession = {
    userId?: string;
    userEmail?: string;
    accessToken?: string;
};

export function getAuthStorageKey(): string {
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
}

/** Token JWT do usuário logado (localStorage — não chama getSession). */
export function getAuthAccessToken(): string | null {
    return readCachedAuthSession().accessToken ?? null;
}

/** Lê sessão do localStorage (instantâneo — evita tela preta enquanto getSession trava). */
export function readCachedAuthSession(): CachedAuthSession {
    try {
        const raw = localStorage.getItem(getAuthStorageKey());
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

/** Grava sessão no localStorage e notifica a app (sem depender de setSession). */
export function persistAuthSession(session: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
    user: User;
}): void {
    const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in;
    localStorage.setItem(
        getAuthStorageKey(),
        JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            expires_at: expiresAt,
            token_type: 'bearer',
            user: session.user,
        }),
    );
    window.dispatchEvent(
        new CustomEvent(AUTH_SIGNED_IN_EVENT, {
            detail: {
                userId: session.user.id,
                userEmail: session.user.email ?? undefined,
            },
        }),
    );
}
