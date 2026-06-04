import { resolveClientPostLoginPath, resolvePendingManagerRegistrationPath } from '@/utils/safe-login-redirect';
import { resolveManagerPostLoginPath } from '@/utils/manager-post-login-path';
import {
    MANAGER_COMPANY_REGISTER_DRAFT_KEY,
    MANAGER_COMPANY_REGISTER_PATH,
} from '@/utils/promoter-registration-flow';
import { supabase } from '@/integrations/supabase/client';

export type PostLoginRedirect = {
    path: string;
    message: string;
};

export async function resolvePostLoginRedirect(
    userId: string,
    returnTo: unknown,
): Promise<PostLoginRedirect> {
    const pendingManagerRegistration = resolvePendingManagerRegistrationPath(returnTo);
    if (pendingManagerRegistration) {
        return {
            path: pendingManagerRegistration,
            message: 'E-mail confirmado! Conclua o cadastro da sua empresa.',
        };
    }

    if (sessionStorage.getItem(MANAGER_COMPANY_REGISTER_DRAFT_KEY)) {
        return {
            path: MANAGER_COMPANY_REGISTER_PATH,
            message: 'E-mail confirmado! Conclua o cadastro da sua empresa.',
        };
    }

    const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('tipo_usuario_id')
        .eq('id', userId)
        .single();

    if (profileError || !profileData) {
        throw new Error('PROFILE_NOT_FOUND');
    }

    const userType = profileData.tipo_usuario_id;

    if (userType === 1) {
        return { path: '/admin/dashboard', message: 'Login de Administrador Master realizado com sucesso!' };
    }
    if (userType === 2) {
        return {
            path: await resolveManagerPostLoginPath(userId),
            message: 'Login de Gestor PRO realizado com sucesso!',
        };
    }
    if (userType === 3) {
        return {
            path: resolveClientPostLoginPath(returnTo),
            message: 'Login de Cliente realizado com sucesso!',
        };
    }

    throw new Error('UNKNOWN_USER_TYPE');
}
