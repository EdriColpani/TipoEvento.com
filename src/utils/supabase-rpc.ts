import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export class RpcTimeoutError extends Error {
    constructor(message = 'A operação demorou demais. Tente novamente.') {
        super(message);
        this.name = 'RpcTimeoutError';
    }
}

function formatRpcError(error: PostgrestError): string {
    const parts = [error.message, error.details, error.hint].filter(Boolean);
    return parts.join(' — ') || 'Erro na operação.';
}

/** RPC com timeout para evitar UI travada em consultas lentas no banco. */
export async function callRpc<T>(
    fn: string,
    args: Record<string, unknown>,
    timeoutMs = 30_000,
): Promise<T> {
    const rpcPromise = supabase.rpc(fn, args).then(({ data, error }) => {
        if (error) {
            throw new Error(formatRpcError(error));
        }
        return data as T;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RpcTimeoutError()), timeoutMs);
    });

    try {
        return await Promise.race([rpcPromise, timeoutPromise]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
