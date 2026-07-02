import { resolveManagerPostLoginPath } from '@/utils/manager-post-login-path';
import {
    ADMIN_MASTER_USER_TYPE_ID,
    MANAGER_PRO_USER_TYPE_ID,
} from '@/utils/public-launch-access';

/** Destino correto após login ou ao sair da vitrine pública. */
export async function resolveRoleHomePath(
    userId: string,
    tipoUsuarioId: number,
): Promise<string> {
    if (tipoUsuarioId === ADMIN_MASTER_USER_TYPE_ID) {
        return '/admin/dashboard';
    }
    if (tipoUsuarioId === MANAGER_PRO_USER_TYPE_ID) {
        return resolveManagerPostLoginPath(userId);
    }
    return '/';
}

export function isStaffUserType(tipoUsuarioId: number | undefined): boolean {
    return (
        tipoUsuarioId === ADMIN_MASTER_USER_TYPE_ID ||
        tipoUsuarioId === MANAGER_PRO_USER_TYPE_ID
    );
}
