import type { NavigateFunction } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';
import { resolveManagerPostLoginPath } from '@/utils/manager-post-login-path';
import { registerUserViaResend } from '@/utils/auth-email-via-resend';
import { PENDING_PROMOTER_METADATA_KEY } from '@/utils/manager-company-registration';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';
import { showError, showSuccess } from '@/utils/toast';

export const USER_TYPE_ADMIN = 1;
export const USER_TYPE_MANAGER = 2;
export const USER_TYPE_CLIENT = 3;

export const MANAGER_ACCOUNT_REGISTER_PATH = '/manager/register/account';
export const MANAGER_COMPANY_REGISTER_PATH = '/manager/register/company';
export const MANAGER_TERMS_REGISTER_PATH = '/manager/register';

export type RegisterPromoterAccountResult =
    | { ok: true; needsConfirmation: true }
    | { ok: true; needsConfirmation: false }
    | { ok: false; message: string };

/** Etapa 1 do promotor: só cria conta e envia e-mail (sem dados da empresa). */
export async function registerPromoterAccountViaResend(input: {
    email: string;
    password: string;
    accountName: string;
}): Promise<RegisterPromoterAccountResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    if (!normalizedEmail || !input.password) {
        return { ok: false, message: 'Informe e-mail e senha.' };
    }
    if (input.password.length < 6) {
        return { ok: false, message: 'A senha deve ter no mínimo 6 caracteres.' };
    }

    const registerResult = await registerUserViaResend({
        email: normalizedEmail,
        password: input.password,
        redirectPath: MANAGER_COMPANY_REGISTER_PATH,
        metadata: {
            name: input.accountName.trim() || 'Gestor EventFest',
            [PENDING_PROMOTER_METADATA_KEY]: true,
        },
    });

    if (registerResult.ok) {
        return { ok: true, needsConfirmation: true };
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: input.password,
    });
    if (signInError || !signInData.user?.id) {
        return { ok: false, message: registerResult.message };
    }
    if (!isAuthEmailConfirmed(signInData.user)) {
        await signOutLocalSession();
        return { ok: true, needsConfirmation: true };
    }
    return { ok: true, needsConfirmation: false };
}

export type PromoterCtaProfile = {
    tipo_usuario_id?: number | null;
};

/**
 * Destino do CTA "Seja um Promotor" / "Começar Agora" na landing.
 *
 * Fluxo "Seja um Promotor" / "Começar Agora":
 * 1. Visitante → /manager/register/account (conta + e-mail de confirmação)
 * 2. Após confirmar e-mail → /manager/register/company (dados da empresa, uma vez)
 * 3. Perfil vira Gestor PRO + empresa criada
 */
async function resolveUserType(
    userId: string,
    profile: PromoterCtaProfile | null | undefined,
): Promise<number | null> {
    if (profile?.tipo_usuario_id != null) {
        return Number(profile.tipo_usuario_id);
    }
    const { data, error } = await supabase
        .from('profiles')
        .select('tipo_usuario_id')
        .eq('id', userId)
        .maybeSingle();
    if (error || data?.tipo_usuario_id == null) {
        return null;
    }
    return Number(data.tipo_usuario_id);
}

export async function navigateFromPromoterCta(
    navigate: NavigateFunction,
    userId: string | undefined,
    profile: PromoterCtaProfile | null | undefined,
): Promise<void> {
    if (!userId) {
        navigate(MANAGER_ACCOUNT_REGISTER_PATH, {
            state: { fromPromoterCta: true },
        });
        return;
    }

    const userType = await resolveUserType(userId, profile);

    if (userType == null) {
        showError('Não foi possível identificar seu tipo de conta. Faça login e tente novamente.');
        navigate('/login', { state: { from: MANAGER_COMPANY_REGISTER_PATH } });
        return;
    }

    if (userType === USER_TYPE_ADMIN) {
        showSuccess('Você já acessa como administrador master.');
        navigate('/admin/dashboard');
        return;
    }

    if (userType === USER_TYPE_MANAGER) {
        const companyId = await fetchManagerPrimaryCompanyId(supabase, userId);
        if (companyId) {
            const path = await resolveManagerPostLoginPath(userId);
            showSuccess('Você já é gestor PRO. Redirecionando para o painel.');
            navigate(path);
            return;
        }
        navigate(MANAGER_COMPANY_REGISTER_PATH, { state: { fromPromoterCta: true } });
        return;
    }

    if (userType === USER_TYPE_CLIENT) {
        navigate(MANAGER_COMPANY_REGISTER_PATH, { state: { fromPromoterCta: true } });
        return;
    }

    navigate('/login', { state: { from: MANAGER_COMPANY_REGISTER_PATH } });
}

export type EnsureAuthForCompanyResult =
    | { status: 'ready'; userId: string }
    | { status: 'email_confirmation_required'; email: string };

export {
    MANAGER_COMPANY_REGISTER_DRAFT_KEY,
    saveCompanyRegisterDraft,
    loadCompanyRegisterDraft,
    clearCompanyRegisterDraft,
    finalizeManagerCompanyRegistration,
    hasPendingPromoterRegistration,
} from '@/utils/manager-company-registration';

async function signOutLocalSession(): Promise<void> {
    await supabase.auth.signOut({ scope: 'local' });
}

function pendingConfirmation(email: string): EnsureAuthForCompanyResult {
    return { status: 'email_confirmation_required', email };
}

async function resolveExistingUser(existingUserId: string, fallbackEmail: string): Promise<EnsureAuthForCompanyResult> {
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id || user.id !== existingUserId) {
        throw new Error('Sessão inválida. Faça login novamente.');
    }
    if (!isAuthEmailConfirmed(user)) {
        await signOutLocalSession();
        return pendingConfirmation(user.email ?? fallbackEmail);
    }
    return { status: 'ready', userId: user.id };
}

export async function ensureAuthUserForCompanyRegistration(
    email: string,
    password: string,
    accountName: string,
    existingUserId: string | null,
): Promise<EnsureAuthForCompanyResult> {
    const normalizedEmail = email.trim().toLowerCase();

    if (existingUserId) {
        return resolveExistingUser(existingUserId, normalizedEmail);
    }

    if (!normalizedEmail || !password) {
        throw new Error('Informe e-mail e senha para criar sua conta de gestor.');
    }
    if (password.length < 6) {
        throw new Error('A senha deve ter no mínimo 6 caracteres.');
    }

    const registerResult = await registerUserViaResend({
        email: normalizedEmail,
        password,
        redirectPath: MANAGER_COMPANY_REGISTER_PATH,
        metadata: {
            name: accountName.trim() || 'Gestor EventFest',
            [PENDING_PROMOTER_METADATA_KEY]: true,
        },
    });

    if (registerResult.ok) {
        return pendingConfirmation(normalizedEmail);
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
    });
    if (signInError || !signInData.user?.id) {
        throw new Error(registerResult.message || 'Já existe uma conta com este e-mail. Confirme o e-mail ou faça login.');
    }
    if (!isAuthEmailConfirmed(signInData.user)) {
        await signOutLocalSession();
        return pendingConfirmation(normalizedEmail);
    }
    return { status: 'ready', userId: signInData.user.id };
}
