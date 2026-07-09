import { supabaseAnonKey, supabaseUrl } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { AUTH_SIGNED_OUT_EVENT, clearAuthSessionStorage } from '@/utils/sign-out-session';

function authHeaders(): Record<string, string> {
    const token = readCachedAuthSession().accessToken;
    if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }
    return {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

type RestErrorPayload = { message?: string } | null;

function normalizeRestError(response: Response, data: unknown, fallback: string): Error {
    const row = data as RestErrorPayload;
    const message = row?.message ?? fallback;
    const lower = message.toLowerCase();
    const isSessionExpired =
        response.status === 401 || response.status === 403 || lower.includes('jwt expired');

    if (isSessionExpired) {
        clearAuthSessionStorage();
        window.dispatchEvent(new CustomEvent(AUTH_SIGNED_OUT_EVENT));
        return new Error('Sessão expirada. Faça login novamente.');
    }

    return new Error(message);
}

export async function restGet<T>(
    path: string,
    timeoutMs = 10_000,
): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                ...authHeaders(),
                Accept: 'application/json',
            },
        });

        const data = (await response.json().catch(() => null)) as T;
        if (!response.ok) {
            throw normalizeRestError(response, data, 'Erro ao consultar dados.');
        }
        return data;
    } finally {
        window.clearTimeout(timer);
    }
}

export async function restPost<T>(
    path: string,
    body: Record<string, unknown> | Record<string, unknown>[],
    timeoutMs = 10_000,
): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                ...authHeaders(),
                Accept: 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw normalizeRestError(response, data, 'Erro ao criar dados.');
        }

        if (response.status === 204) {
            return {} as T;
        }

        return (await response.json().catch(() => ({}))) as T;
    } finally {
        window.clearTimeout(timer);
    }
}

export async function restPatch<T>(
    path: string,
    body: Record<string, unknown>,
    timeoutMs = 10_000,
): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
            method: 'PATCH',
            signal: controller.signal,
            headers: {
                ...authHeaders(),
                Accept: 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw normalizeRestError(response, data, 'Erro ao atualizar dados.');
        }

        if (response.status === 204) {
            return {} as T;
        }

        return (await response.json().catch(() => ({}))) as T;
    } finally {
        window.clearTimeout(timer);
    }
}

export async function restDelete(path: string, timeoutMs = 10_000): Promise<void> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
            method: 'DELETE',
            signal: controller.signal,
            headers: {
                ...authHeaders(),
                Accept: 'application/json',
                Prefer: 'return=minimal',
            },
        });

        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw normalizeRestError(response, data, 'Erro ao excluir dados.');
        }
    } finally {
        window.clearTimeout(timer);
    }
}
