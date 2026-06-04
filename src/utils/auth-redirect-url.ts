/** Origem pública do app (build/deploy). Evita redirect para localhost no e-mail de confirmação. */
const DEFAULT_SITE_ORIGIN = 'https://www.eventfest.com.br';

export function getAppOrigin(): string {
    const fromEnv = import.meta.env.VITE_SITE_URL?.trim();
    if (fromEnv) {
        return fromEnv.replace(/\/$/, '');
    }
    if (typeof window !== 'undefined' && window.location.origin) {
        const origin = window.location.origin;
        if (!origin.includes('127.0.0.1') && !origin.includes('localhost')) {
            return origin;
        }
    }
    return DEFAULT_SITE_ORIGIN;
}

/** URL usada em signUp / resend / recovery — deve estar nas Redirect URLs do Supabase. */
export function getAuthEmailRedirectUrl(path = '/login'): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${getAppOrigin()}${normalizedPath}`;
}
