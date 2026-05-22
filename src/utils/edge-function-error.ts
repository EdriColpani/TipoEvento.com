import { FunctionsHttpError } from '@supabase/supabase-js';

type EdgeErrorPayload = { error?: string; hint?: string };

/** Extrai mensagem legível de `functions.invoke` quando a Edge Function retorna 4xx/5xx. */
export async function parseEdgeFunctionError(
    invokeError: { message?: string } | null,
    data: unknown,
): Promise<string> {
    let payload = data as EdgeErrorPayload | undefined;
    if ((!payload || typeof payload !== 'object') && invokeError instanceof FunctionsHttpError) {
        try {
            const body = await invokeError.context.json();
            if (body && typeof body === 'object') {
                payload = body as EdgeErrorPayload;
            }
        } catch {
            /* ignore */
        }
    }
    if (payload?.error) {
        return payload.hint ? `${payload.error} — ${payload.hint}` : payload.error;
    }
    return invokeError?.message ?? 'Erro na requisição ao servidor.';
}
