import { supabaseAnonKey, supabaseUrl } from '@/integrations/supabase/client';
import { getAuthAccessToken } from '@/utils/auth-session-cache';

type EdgeErrorPayload = { error?: string; hint?: string; message?: string };

function formatEdgeError(payload: EdgeErrorPayload | null, fallback: string): string {
    if (payload?.error) {
        return payload.hint ? `${payload.error} — ${payload.hint}` : payload.error;
    }
    return payload?.message ?? fallback;
}

/** Invoca Edge Function via fetch + token em cache (evita deadlock do cliente Supabase). */
export async function invokeEdgeFunctionRest<T>(
    functionName: string,
    body: unknown,
    options?: { timeoutMs?: number; idempotencyKey?: string },
): Promise<T> {
    const token = getAuthAccessToken();
    if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }

    const timeoutMs = options?.timeoutMs ?? 25_000;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
    };
    if (options?.idempotencyKey) {
        headers['x-idempotency-key'] = options.idempotencyKey;
    }

    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
            method: 'POST',
            signal: controller.signal,
            headers,
            body: JSON.stringify(body),
        });

        const data = (await response.json().catch(() => null)) as T & EdgeErrorPayload | null;

        if (!response.ok) {
            throw new Error(formatEdgeError(data, `Erro ao chamar ${functionName}.`));
        }

        return data as T;
    } finally {
        window.clearTimeout(timer);
    }
}
