import { supabaseAnonKey, supabaseUrl } from '@/integrations/supabase/client';
import { readCachedAuthSession, persistAuthSession } from '@/utils/auth-session-cache';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promise-timeout';

export type AuthUserRestResult =
    | { user: User; error: null }
    | { user: null; error: { message: string; status?: number } };

/** Valida token via Auth REST — não chama getSession/getUser do client JS. */
export async function fetchAuthUserViaRest(
    accessToken?: string | null,
    timeoutMs = 5_000,
): Promise<AuthUserRestResult> {
    const token = accessToken ?? readCachedAuthSession().accessToken;
    if (!token) {
        return { user: null, error: { message: 'no_token' } };
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
            },
        });

        const data = (await response.json().catch(() => null)) as User | { message?: string } | null;

        if (!response.ok || !data || !('id' in data) || !data.id) {
            return {
                user: null,
                error: {
                    message:
                        (data && 'message' in data && data.message) ||
                        'Sessão inválida ou expirada.',
                    status: response.status,
                },
            };
        }

        return { user: data as User, error: null };
    } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        return {
            user: null,
            error: {
                message: aborted ? 'timeout' : 'network_error',
            },
        };
    } finally {
        window.clearTimeout(timer);
    }
}

type UpdateUserRestResult = {
    user?: { id?: string } | null;
    error?: { message?: string } | null;
};

/** Atualiza senha via Auth REST — evita deadlock do client JS após updateUser. */
export async function updatePasswordViaRest(
    password: string,
    userMetadata?: Record<string, unknown>,
    timeoutMs = 12_000,
): Promise<UpdateUserRestResult> {
    const token = readCachedAuthSession().accessToken;
    if (!token) {
        return { error: { message: 'Sessão expirada. Abra o link do e-mail novamente.' } };
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'PUT',
            signal: controller.signal,
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                password,
                ...(userMetadata ? { data: userMetadata } : {}),
            }),
        });

        const data = (await response.json().catch(() => null)) as {
            id?: string;
            message?: string;
            error_description?: string;
        } | null;

        if (!response.ok) {
            return {
                error: {
                    message:
                        data?.message ??
                        data?.error_description ??
                        'Não foi possível atualizar a senha.',
                },
            };
        }

        return { user: { id: data?.id } };
    } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        return {
            error: {
                message: aborted
                    ? 'Tempo esgotado ao salvar a senha.'
                    : 'Não foi possível salvar a senha.',
            },
        };
    } finally {
        window.clearTimeout(timer);
    }
}

export type SignInRestResult =
    | { data: { user: User; session: Session }; error: null }
    | { data: null; error: { message: string; code?: string } };

/** Login via Auth REST — evita deadlock do signInWithPassword. */
export async function signInWithPasswordViaRest(
    email: string,
    password: string,
    timeoutMs = 15_000,
): Promise<SignInRestResult> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                apikey: supabaseAnonKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        const data = (await response.json().catch(() => null)) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            expires_at?: number;
            user?: User;
            error?: string;
            error_description?: string;
            msg?: string;
        } | null;

        if (!response.ok || !data?.access_token || !data.refresh_token || !data.user) {
            const message =
                data?.error_description ??
                data?.msg ??
                data?.error ??
                'Credenciais inválidas ou usuário não encontrado.';
            const isInvalid =
                response.status === 400 ||
                message.toLowerCase().includes('invalid') ||
                message.toLowerCase().includes('credentials');
            return {
                data: null,
                error: { message, code: isInvalid ? 'invalid_credentials' : 'auth_error' },
            };
        }

        const session: Session = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in ?? 3600,
            expires_at: data.expires_at,
            token_type: 'bearer',
            user: data.user,
        };

        persistAuthSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in ?? 3600,
            expires_at: data.expires_at,
            user: data.user,
        });

        void withTimeout(
            supabase.auth.setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
            }),
            4_000,
            { data: { session: null, user: null }, error: null },
        );

        return { data: { user: data.user, session }, error: null };
    } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        return {
            data: null,
            error: {
                message: aborted
                    ? 'Tempo esgotado ao entrar. Tente novamente.'
                    : 'Não foi possível conectar. Verifique sua internet.',
                code: aborted ? 'timeout' : 'network_error',
            },
        };
    } finally {
        window.clearTimeout(timer);
    }
}

/** Login com REST primeiro; fallback limitado ao client JS. */
export async function signInWithPasswordResilient(
    email: string,
    password: string,
): Promise<SignInRestResult> {
    const restResult = await signInWithPasswordViaRest(email, password);
    if (restResult.data?.user) {
        return restResult;
    }
    if (restResult.error?.code === 'invalid_credentials') {
        return restResult;
    }

    const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        12_000,
        { data: { user: null, session: null }, error: { message: 'timeout', name: 'Timeout' } },
    );

    if (error || !data.user) {
        return {
            data: null,
            error: {
                message:
                    error?.message === 'timeout'
                        ? 'Tempo esgotado ao entrar. Limpe os cookies e tente novamente.'
                        : restResult.error?.message ?? 'Credenciais inválidas ou usuário não encontrado.',
                code: error?.message === 'timeout' ? 'timeout' : restResult.error?.code,
            },
        };
    }

    if (data.session) {
        persistAuthSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_in: data.session.expires_in ?? 3600,
            expires_at: data.session.expires_at,
            user: data.user,
        });
    }

    return {
        data: { user: data.user, session: data.session! },
        error: null,
    };
}
