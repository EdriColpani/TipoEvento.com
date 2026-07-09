import { resolveClientPostLoginPath, resolvePendingManagerRegistrationPath } from '@/utils/safe-login-redirect';
import { resolveManagerPostLoginPath } from '@/utils/manager-post-login-path';
import {
    consumeComplimentaryReturnPath,
    resolveComplimentaryReturnPath,
} from '@/utils/complimentary-auth-return';
import {
    hasPendingPromoterRegistration,
    MANAGER_COMPANY_REGISTER_DRAFT_KEY,
    MANAGER_COMPANY_REGISTER_PATH,
} from '@/utils/manager-company-registration';
import type { User } from '@supabase/supabase-js';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { fetchAuthUserViaRest } from '@/utils/auth-rest';
import { fetchProfileTipoUsuarioId } from '@/utils/fetch-profile-tipo';
import { withTimeout } from '@/utils/promise-timeout';

export type PostLoginRedirect = {
    path: string;
    message: string;
};

export async function resolvePostLoginRedirect(
    userId: string,
    returnTo: unknown,
    authUser?: User | null,
): Promise<PostLoginRedirect> {
    const complimentaryPath = resolveComplimentaryReturnPath(returnTo);
    if (complimentaryPath) {
        consumeComplimentaryReturnPath();
        return {
            path: resolveClientPostLoginPath(complimentaryPath),
            message: 'Login realizado. Continue com seu ingresso cortesia.',
        };
    }

    const pendingManagerRegistration = resolvePendingManagerRegistrationPath(returnTo);
    if (pendingManagerRegistration && !resolveComplimentaryReturnPath(undefined)) {
        return {
            path: pendingManagerRegistration,
            message: 'E-mail confirmado! Conclua o cadastro da sua empresa.',
        };
    }

    if (
        sessionStorage.getItem(MANAGER_COMPANY_REGISTER_DRAFT_KEY) &&
        !resolveComplimentaryReturnPath(undefined)
    ) {
        return {
            path: MANAGER_COMPANY_REGISTER_PATH,
            message: 'E-mail confirmado! Conclua o cadastro da sua empresa.',
        };
    }

    let user = authUser ?? null;
    if (!user) {
        const cached = readCachedAuthSession();
        if (cached.accessToken) {
            const { user: restUser } = await fetchAuthUserViaRest(cached.accessToken, 5_000);
            user = restUser;
        }
    }
    if (hasPendingPromoterRegistration(user) && !resolveComplimentaryReturnPath(undefined)) {
        return {
            path: MANAGER_COMPANY_REGISTER_PATH,
            message: 'E-mail confirmado! Conclua o cadastro da sua empresa.',
        };
    }

    const userType = await fetchProfileTipoUsuarioId(userId);
    if (userType == null) {
        throw new Error('PROFILE_NOT_FOUND');
    }

    if (userType === 1) {
        return { path: '/admin/dashboard', message: 'Login de Administrador Master realizado com sucesso!' };
    }
    if (userType === 2) {
        return {
            path: await withTimeout(resolveManagerPostLoginPath(userId), 6000, '/manager/dashboard'),
            message: 'Login de gestor realizado com sucesso!',
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
