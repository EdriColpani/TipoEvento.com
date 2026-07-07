import { supabaseAnonKey, supabaseUrl } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';

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
            const row = data as { message?: string } | null;
            throw new Error(row?.message ?? 'Erro ao consultar dados.');
        }
        return data;
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
            const data = (await response.json().catch(() => null)) as { message?: string } | null;
            throw new Error(data?.message ?? 'Erro ao atualizar dados.');
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
            const data = (await response.json().catch(() => null)) as { message?: string } | null;
            throw new Error(data?.message ?? 'Erro ao excluir dados.');
        }
    } finally {
        window.clearTimeout(timer);
    }
}
