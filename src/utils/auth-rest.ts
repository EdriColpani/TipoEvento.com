import { supabaseAnonKey, supabaseUrl } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';

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
