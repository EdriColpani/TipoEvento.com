import { supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';
import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { withTimeout } from '@/utils/promise-timeout';

async function getAccessToken(): Promise<string | null> {
    const cached = getAuthAccessToken();
    if (cached) return cached;
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await withTimeout(
        supabase.auth.getSession(),
        3_000,
        { data: { session: null } },
    );
    return data.session?.access_token ?? null;
}

export type PdvOperatorInviteResult =
    | { ok: true; mode?: string; message?: string; linked_immediately?: boolean }
    | { ok: false; message: string };

/** Convida operador PDV: vincula/convite + e-mail (cadastro ou login). */
export async function invitePdvOperatorWithEmail(input: {
    companyId: string;
    operatorEmail: string;
    companyName: string;
}): Promise<PdvOperatorInviteResult> {
    if (!supabaseUrl || !supabaseAnonKey) {
        return { ok: false, message: 'Configuração do Supabase ausente no app.' };
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
        return { ok: false, message: 'Sessão expirada. Faça login novamente.' };
    }

    try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 30_000);

        const response = await fetch(`${supabaseUrl}/functions/v1/invite-pdv-operator`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                companyId: input.companyId,
                operatorEmail: input.operatorEmail.trim().toLowerCase(),
                companyName: input.companyName.trim(),
            }),
        });

        window.clearTimeout(timer);

        const data = (await response.json().catch(() => ({}))) as {
            success?: boolean;
            message?: string;
            error?: string;
            mode?: string;
            linked_immediately?: boolean;
        };

        if (response.ok && data.success) {
            return {
                ok: true,
                mode: data.mode,
                message: data.message,
                linked_immediately: data.linked_immediately,
            };
        }

        if (data.message) {
            return { ok: false, message: data.message };
        }

        if (data.error === 'server_misconfigured' || data.error === 'resend_rejected') {
            return {
                ok: false,
                message: 'Serviço de e-mail indisponível. Verifique a Resend no Supabase.',
            };
        }

        return { ok: false, message: 'Não foi possível convidar o operador.' };
    } catch (error) {
        console.error('[invitePdvOperatorWithEmail]:', error);
        if (error instanceof Error && error.name === 'AbortError') {
            return { ok: false, message: 'Tempo esgotado ao enviar o convite. Tente novamente.' };
        }
        return { ok: false, message: 'Erro de rede ao convidar o operador.' };
    }
}
