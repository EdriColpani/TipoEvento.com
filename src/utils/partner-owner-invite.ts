import { supabase, supabaseUrl, supabaseAnonKey } from '@/integrations/supabase/client';

export type PartnerOwnerInviteResult =
    | { ok: true; mode?: string; message?: string }
    | { ok: false; message: string };

/** Envia e-mail obrigatório ao gestor dono da empresa parceira (criar senha ou entrar). */
export async function sendPartnerOwnerInviteEmail(input: {
    companyId: string;
    ownerEmail: string;
    companyName: string;
}): Promise<PartnerOwnerInviteResult> {
    if (!supabaseUrl || !supabaseAnonKey) {
        return { ok: false, message: 'Configuração do Supabase ausente no app.' };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
        return { ok: false, message: 'Sessão expirada. Faça login novamente.' };
    }

    try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 25_000);

        const response = await fetch(`${supabaseUrl}/functions/v1/invite-partner-company-owner`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                companyId: input.companyId,
                ownerEmail: input.ownerEmail.trim().toLowerCase(),
                companyName: input.companyName.trim(),
            }),
        });

        window.clearTimeout(timer);

        const data = (await response.json().catch(() => ({}))) as {
            success?: boolean;
            message?: string;
            error?: string;
            mode?: string;
        };

        if (response.ok && data.success) {
            return { ok: true, mode: data.mode, message: data.message };
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

        return {
            ok: false,
            message: 'Não foi possível enviar o e-mail de convite ao gestor.',
        };
    } catch (error) {
        console.error('[sendPartnerOwnerInviteEmail]:', error);
        if (error instanceof Error && error.name === 'AbortError') {
            return { ok: false, message: 'Tempo esgotado ao enviar o e-mail. Tente "Enviar convite" na lista de empresas.' };
        }
        return { ok: false, message: 'Erro de rede ao enviar o e-mail de convite.' };
    }
}
