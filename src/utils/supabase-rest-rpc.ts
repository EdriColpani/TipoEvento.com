import { supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';
import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { clearAuthSessionStorage, AUTH_SIGNED_OUT_EVENT } from '@/utils/sign-out-session';
import { RpcTimeoutError } from '@/utils/supabase-rpc';

function formatRestRpcError(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return 'Erro na operação.';
    const row = payload as Record<string, unknown>;
    const parts = [row.message, row.details, row.hint, row.error].filter(
        (v) => typeof v === 'string' && v.trim(),
    );
    return parts.join(' — ') || 'Erro na operação.';
}

function isJwtAuthError(message: string, status?: number): boolean {
    const lower = message.toLowerCase();
    return (
        status === 401 ||
        lower.includes('jwt expired') ||
        lower.includes('invalid jwt') ||
        lower.includes('session expired')
    );
}

async function postRpc<T>(
    fn: string,
    args: Record<string, unknown>,
    authorization: string,
    timeoutMs: number,
): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${authorization}`,
            },
            body: JSON.stringify(args),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message = formatRestRpcError(data);
            if (isJwtAuthError(message, response.status)) {
                throw new Error('JWT expired');
            }
            throw new Error(message);
        }

        return data as T;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new RpcTimeoutError();
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

/** RPC público (anon) — formulários de contato/feedback sem login. */
export async function callRpcPublicRest<T>(
    fn: string,
    args: Record<string, unknown>,
    timeoutMs = 12_000,
): Promise<T> {
    return postRpc<T>(fn, args, supabaseAnonKey, timeoutMs);
}

/**
 * RPC via REST + token do localStorage — evita deadlock do supabase-js (rpc/getSession).
 */
export async function callRpcRest<T>(
    fn: string,
    args: Record<string, unknown>,
    timeoutMs = 20_000,
): Promise<T> {
    const token = getAuthAccessToken();
    if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }

    try {
        return await postRpc<T>(fn, args, token, timeoutMs);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isJwtAuthError(message)) {
            clearAuthSessionStorage();
            window.dispatchEvent(new CustomEvent(AUTH_SIGNED_OUT_EVENT));
            throw new Error('Sessão expirada. Faça login novamente.');
        }
        throw error;
    }
}

/** RPC com sessão se houver; senão anon (páginas públicas). Retry anon se JWT expirado. */
export async function callRpcAuthOrPublicRest<T>(
    fn: string,
    args: Record<string, unknown>,
    timeoutMs = 15_000,
): Promise<T> {
    const token = getAuthAccessToken();
    if (!token) {
        return postRpc<T>(fn, args, supabaseAnonKey, timeoutMs);
    }

    try {
        return await postRpc<T>(fn, args, token, timeoutMs);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isJwtAuthError(message)) {
            clearAuthSessionStorage();
            window.dispatchEvent(new CustomEvent(AUTH_SIGNED_OUT_EVENT));
            return postRpc<T>(fn, args, supabaseAnonKey, timeoutMs);
        }
        throw error;
    }
}
