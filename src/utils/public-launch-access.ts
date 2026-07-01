export type PublicLaunchMode = 'preview' | 'live';

export const ADMIN_MASTER_USER_TYPE_ID = 1;
export const MANAGER_PRO_USER_TYPE_ID = 2;

/** Rotas liberadas para visitantes não logados. */
export const GUEST_ALLOWED_PATHS = new Set([
    '/informacoes',
    '/login',
    '/forgot-password',
]);

/** Rotas de cadastro (cliente e gestor). */
export const PUBLIC_LAUNCH_REGISTRATION_PATHS = [
    '/register',
    '/manager/register',
    '/manager/register/account',
    '/manager/register/company',
] as const;

/** @deprecated Use GUEST_ALLOWED_PATHS */
export const PUBLIC_LAUNCH_ALLOWED_PATHS = GUEST_ALLOWED_PATHS;

export function isGuestAllowedPath(pathname: string): boolean {
    if (GUEST_ALLOWED_PATHS.has(pathname)) {
        return true;
    }
    return isPublicLaunchRegistrationPath(pathname);
}

export function isPublicLaunchRegistrationPath(pathname: string): boolean {
    return (
        pathname === '/register' ||
        pathname === '/manager/register' ||
        pathname.startsWith('/manager/register/')
    );
}

export function normalizePublicLaunchMode(value: unknown): PublicLaunchMode {
    return value === 'preview' ? 'preview' : 'live';
}

export function canBypassPublicLaunchPreview(tipoUsuarioId: unknown): boolean {
    const tipo = Number(tipoUsuarioId);
    return tipo === ADMIN_MASTER_USER_TYPE_ID || tipo === MANAGER_PRO_USER_TYPE_ID;
}

/** @deprecated Use isGuestAllowedPath */
export function isPublicLaunchRestrictedPath(pathname: string): boolean {
    return !isGuestAllowedPath(pathname);
}
