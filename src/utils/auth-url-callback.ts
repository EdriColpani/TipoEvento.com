/**
 * Captura hash/query do callback Auth (confirmação de e-mail, erro de link)
 * antes do supabase-js limpar a URL (detectSessionInUrl).
 */

export type AuthUrlCallback = {
    type: string | null;
    error: string | null;
    errorCode: string | null;
    errorDescription: string | null;
    hasAccessToken: boolean;
};

const SIGNUP_STAY_ON_LOGIN_KEY = 'eventfest_signup_stay_on_login';

const EMPTY_CALLBACK: AuthUrlCallback = {
    type: null,
    error: null,
    errorCode: null,
    errorDescription: null,
    hasAccessToken: false,
};

function parseAuthParams(source: string): AuthUrlCallback {
    const raw = source.startsWith('#') || source.startsWith('?') ? source.slice(1) : source;
    if (!raw) return EMPTY_CALLBACK;
    const params = new URLSearchParams(raw);
    const errorDescription = params.get('error_description');
    return {
        type: params.get('type'),
        error: params.get('error'),
        errorCode: params.get('error_code'),
        errorDescription: errorDescription
            ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
            : null,
        hasAccessToken: Boolean(params.get('access_token')),
    };
}

function mergeCallbacks(hash: AuthUrlCallback, search: AuthUrlCallback): AuthUrlCallback {
    return {
        type: hash.type || search.type,
        error: hash.error || search.error,
        errorCode: hash.errorCode || search.errorCode,
        errorDescription: hash.errorDescription || search.errorDescription,
        hasAccessToken: hash.hasAccessToken || search.hasAccessToken,
    };
}

function captureFromWindow(): AuthUrlCallback {
    if (typeof window === 'undefined') return EMPTY_CALLBACK;
    return mergeCallbacks(
        parseAuthParams(window.location.hash || ''),
        parseAuthParams(window.location.search || ''),
    );
}

function isLoginPath(): boolean {
    if (typeof window === 'undefined') return false;
    return window.location.pathname === '/login' || window.location.pathname.endsWith('/login');
}

/** true: retorno do /auth/v1/verify?type=signup (sucesso ou link inválido/expirado). */
export function isSignupEmailCallback(cb: AuthUrlCallback): boolean {
    if (cb.type === 'signup') return true;
    if (!isLoginPath() || !cb.error) return false;
    const code = (cb.errorCode || '').toLowerCase();
    const desc = (cb.errorDescription || '').toLowerCase();
    return (
        code.includes('otp') ||
        desc.includes('email link') ||
        desc.includes('expired') ||
        desc.includes('invalid')
    );
}

export function markStayOnLoginForPassword(): void {
    try {
        sessionStorage.setItem(SIGNUP_STAY_ON_LOGIN_KEY, '1');
    } catch {
        /* ignore */
    }
}

export function shouldStayOnLoginForPassword(): boolean {
    try {
        return sessionStorage.getItem(SIGNUP_STAY_ON_LOGIN_KEY) === '1';
    } catch {
        return false;
    }
}

export function clearStayOnLoginForPassword(): void {
    try {
        sessionStorage.removeItem(SIGNUP_STAY_ON_LOGIN_KEY);
    } catch {
        /* ignore */
    }
}

export function signupCallbackErrorMessage(cb: AuthUrlCallback): string {
    const code = (cb.errorCode || '').toLowerCase();
    const desc = (cb.errorDescription || '').toLowerCase();
    if (code.includes('otp_expired') || desc.includes('expired') || desc.includes('already')) {
        return 'Este link de confirmação já foi usado ou expirou. Entre com e-mail e senha, ou solicite um novo e-mail.';
    }
    if (cb.error) {
        return 'Não foi possível validar o link de confirmação. Entre com e-mail e senha.';
    }
    return 'E-mail confirmado. Entre com e-mail e senha para acessar.';
}

export function stripAuthCallbackFromUrl(): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    for (const key of ['type', 'error', 'error_code', 'error_description', 'code', 'token']) {
        params.delete(key);
    }
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
}

let bootCallback: AuthUrlCallback = EMPTY_CALLBACK;
let captured = false;

/** Deve rodar no carregamento do client Supabase, com o hash ainda na URL. */
export function captureAuthUrlCallbackAtBoot(): AuthUrlCallback {
    if (!captured) {
        bootCallback = captureFromWindow();
        captured = true;
        if (isSignupEmailCallback(bootCallback)) {
            markStayOnLoginForPassword();
        }
    }
    return bootCallback;
}

export function getAuthUrlCallbackAtBoot(): AuthUrlCallback {
    return captureAuthUrlCallbackAtBoot();
}
