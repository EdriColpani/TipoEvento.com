import { supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';

type AuthEmailResult = { ok: true } | { ok: false; message: string };

async function callAuthEmailFunction(
    functionName: string,
    body: Record<string, unknown>,
): Promise<AuthEmailResult> {
    if (!supabaseUrl || !supabaseAnonKey) {
        return { ok: false, message: 'Configuração do Supabase ausente no app.' };
    }

    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify(body),
        });

        const data = (await response.json().catch(() => ({}))) as {
            success?: boolean;
            message?: string;
            error?: string;
        };

        if (response.ok && data.success) {
            return { ok: true };
        }

        if (data.message) {
            return { ok: false, message: data.message };
        }

        if (data.error === 'resend_rejected') {
            return { ok: false, message: 'Serviço de e-mail indisponível. Tente mais tarde.' };
        }

        return {
            ok: false,
            message: 'Não foi possível enviar o e-mail. Tente novamente em instantes.',
        };
    } catch (error) {
        console.error(`${functionName}:`, error);
        return { ok: false, message: 'Erro de rede ao enviar o e-mail.' };
    }
}

/** Cadastro via Admin API + confirmação enviada exclusivamente pela Resend (EventFest). */
export async function registerUserViaResend(input: {
    email: string;
    password: string;
    redirectPath?: string;
    metadata?: Record<string, unknown>;
}): Promise<AuthEmailResult> {
    return callAuthEmailFunction('auth-signup-resend', {
        email: input.email.trim().toLowerCase(),
        password: input.password,
        redirectPath: input.redirectPath ?? '/login',
        metadata: input.metadata ?? {},
    });
}

/** Reset de senha enviado exclusivamente pela Resend (EventFest). */
export async function requestPasswordResetViaResend(
    email: string,
    redirectPath = '/reset-password',
): Promise<AuthEmailResult> {
    return callAuthEmailFunction('auth-recovery-resend', {
        email: email.trim().toLowerCase(),
        redirectPath,
    });
}
