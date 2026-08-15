/**
 * Resolve destino pós-login para cliente: só caminhos internos relativos,
 * sem open redirect; bloqueia áreas administrativas.
 */
export function resolveClientPostLoginPath(fromUnknown: unknown): string {
    if (typeof fromUnknown !== 'string') return '/';
    const path = fromUnknown.trim().split('#')[0]?.split('\0')[0] ?? '';
    if (!path.startsWith('/') || path.startsWith('//')) return '/';
    const lower = path.toLowerCase();
    if (lower.startsWith('/admin') || lower.startsWith('/manager')) return '/';
    if (
        lower.startsWith('/login') ||
        lower.startsWith('/register') ||
        lower.startsWith('/forgot-password') ||
        lower.startsWith('/reset-password')
    ) {
        return '/';
    }
    return path || '/';
}

/**
 * State do React Router ao abrir /login.
 * Home (`/`) não entra como retorno — senão o /login redireciona de volta à landing.
 */
export function buildLoginLocationState(
    pathname: string,
    search = '',
): { from: string } | undefined {
    const path = pathname.trim() || '/';
    if (
        path === '/' ||
        path === '/login' ||
        path === '/register' ||
        path === '/forgot-password' ||
        path === '/reset-password'
    ) {
        return undefined;
    }
    return { from: `${path}${search}` };
}

/** Cadastro gestor pendente após confirmação de e-mail (visitante → login → empresa). */
export function resolvePendingManagerRegistrationPath(fromUnknown: unknown): string | null {
    if (typeof fromUnknown !== 'string') return null;
    const path = fromUnknown.trim().split('#')[0]?.split('\0')[0] ?? '';
    if (!path.startsWith('/') || path.startsWith('//')) return null;
    const lower = path.toLowerCase();
    if (lower === '/manager/register/company' || lower === '/manager/register/account') {
        return path;
    }
    return null;
}
