import { supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';

type ResendSignupResult =
    | { ok: true }
    | { ok: false; message: string };

/** Reenvio via Edge Function + Resend (link com redirect de produção). */
export async function resendSignupConfirmationEmail(
    email: string,
    redirectPath = '/login',
): Promise<ResendSignupResult> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
        return { ok: false, message: 'Informe um e-mail válido.' };
    }

    if (!supabaseUrl || !supabaseAnonKey) {
        return { ok: false, message: 'Configuração do Supabase ausente no app.' };
    }

    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/resend-signup-confirmation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({ email: normalized, redirectPath }),
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
            message: 'Não foi possível reenviar o e-mail. Tente novamente em instantes.',
        };
    } catch (error) {
        console.error('resendSignupConfirmationEmail:', error);
        return { ok: false, message: 'Erro de rede ao reenviar o e-mail.' };
    }
}
