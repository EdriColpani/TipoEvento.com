import { supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';
import { RpcTimeoutError } from '@/utils/supabase-rpc';

function readCachedAccessToken(): string | null {
    try {
        const ref = new URL(supabaseUrl).hostname.split('.')[0];
        const raw = localStorage.getItem(`sb-${ref}-auth-token`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { access_token?: string };
        return parsed.access_token ?? null;
    } catch {
        return null;
    }
}

function formatRestRpcError(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return 'Erro na operação.';
    const row = payload as Record<string, unknown>;
    const parts = [row.message, row.details, row.hint].filter(
        (v) => typeof v === 'string' && v.trim(),
    );
    return parts.join(' — ') || 'Erro na operação.';
}

/**
 * RPC via REST + token do localStorage — evita deadlock do supabase-js (rpc/getSession).
 */
export async function callRpcRest<T>(
    fn: string,
    args: Record<string, unknown>,
    timeoutMs = 20_000,
): Promise<T> {
    const token = readCachedAccessToken();
    if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(args),
        });

        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

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
