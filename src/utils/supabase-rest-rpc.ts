import { supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';
import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { RpcTimeoutError } from '@/utils/supabase-rpc';

function formatRestRpcError(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return 'Erro na operação.';
    const row = payload as Record<string, unknown>;
    const parts = [row.message, row.details, row.hint].filter(
        (v) => typeof v === 'string' && v.trim(),
    );
    return parts.join(' — ') || 'Erro na operação.';
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
            throw new Error(formatRestRpcError(data));
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

    return postRpc<T>(fn, args, token, timeoutMs);
}
