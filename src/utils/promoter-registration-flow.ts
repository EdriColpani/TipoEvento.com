import type { NavigateFunction } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';
import { resolveManagerPostLoginPath } from '@/utils/manager-post-login-path';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';
import { showError, showSuccess } from '@/utils/toast';

export const USER_TYPE_ADMIN = 1;
export const USER_TYPE_MANAGER = 2;
export const USER_TYPE_CLIENT = 3;

export const MANAGER_COMPANY_REGISTER_PATH = '/manager/register/company';
export const MANAGER_TERMS_REGISTER_PATH = '/manager/register';

export type PromoterCtaProfile = {
    tipo_usuario_id?: number | null;
};

/**
 * Destino do CTA "Seja um Promotor" / "Começar Agora" na landing.
 *
 * Fluxo atual do gestor na plataforma:
 * 1. /manager/register — aceite do contrato + escolha PF ou PJ
 * 2. /manager/register/company — dados da empresa + vínculo user_companies (exige login hoje)
 * 3. Perfil vira tipo 2 (Gestor PRO) e empresa é criada
 *
 * Este CTA encurta para clientes logados e visitantes: vai direto ao cadastro de empresa.
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
        navigate(MANAGER_COMPANY_REGISTER_PATH, {
            state: { fromPromoterCta: true, allowGuestSignup: true },
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

export const MANAGER_COMPANY_REGISTER_DRAFT_KEY = 'eventfest_manager_company_register_draft';

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

async function resolveNewSignUpUser(
    signUpUser: User | null,
    normalizedEmail: string,
    hadSession: boolean,
): Promise<EnsureAuthForCompanyResult> {
    if (!signUpUser?.id) {
        throw new Error('Não foi possível criar sua conta. Tente novamente.');
    }

    if (!isAuthEmailConfirmed(signUpUser)) {
        if (hadSession) {
            await signOutLocalSession();
        }
        return pendingConfirmation(normalizedEmail);
    }

    return { status: 'ready', userId: signUpUser.id };
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

    const emailRedirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
            emailRedirectTo,
            data: { name: accountName.trim() || 'Gestor EventFest' },
        },
    });

    if (signUpError) {
        const alreadyExists =
            signUpError.message.includes('already registered') ||
            signUpError.message.includes('User already registered');
        if (!alreadyExists) {
            throw signUpError;
        }
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
        });
        if (signInError || !signInData.user?.id) {
            throw new Error(
                'Já existe uma conta com este e-mail. Confirme o e-mail ou faça login para continuar.',
            );
        }
        if (!isAuthEmailConfirmed(signInData.user)) {
            await signOutLocalSession();
            return pendingConfirmation(normalizedEmail);
        }
        return { status: 'ready', userId: signInData.user.id };
    }

    const signUpUser = signUpData.session?.user ?? signUpData.user ?? null;
    return resolveNewSignUpUser(signUpUser, normalizedEmail, Boolean(signUpData.session));
}
