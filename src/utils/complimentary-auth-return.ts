/** Preserva retorno ao fluxo cortesia após cadastro/confirmação de e-mail (localStorage sobrevive a nova aba do e-mail). */
export const COMPLIMENTARY_RETURN_STORAGE_KEY = 'eventfest_complimentary_return_path';

export function isComplimentaryReturnPath(path: unknown): path is string {
    if (typeof path !== 'string') return false;
    const normalized = path.trim().split('#')[0]?.split('\0')[0] ?? '';
    return normalized.startsWith('/cortesia/');
}

function readStoredReturnPath(): string | null {
    const fromLocal = localStorage.getItem(COMPLIMENTARY_RETURN_STORAGE_KEY);
    if (isComplimentaryReturnPath(fromLocal)) {
        return fromLocal.trim();
    }

    const fromSession = sessionStorage.getItem(COMPLIMENTARY_RETURN_STORAGE_KEY);
    if (isComplimentaryReturnPath(fromSession)) {
        const trimmed = fromSession.trim();
        localStorage.setItem(COMPLIMENTARY_RETURN_STORAGE_KEY, trimmed);
        sessionStorage.removeItem(COMPLIMENTARY_RETURN_STORAGE_KEY);
        return trimmed;
    }

    return null;
}

export function saveComplimentaryReturnPath(path: string): void {
    if (!isComplimentaryReturnPath(path)) return;
    localStorage.setItem(COMPLIMENTARY_RETURN_STORAGE_KEY, path.trim());
    sessionStorage.removeItem(COMPLIMENTARY_RETURN_STORAGE_KEY);
}

export function peekComplimentaryReturnPath(): string | null {
    return readStoredReturnPath();
}

export function consumeComplimentaryReturnPath(): string | null {
    const stored = peekComplimentaryReturnPath();
    if (stored) {
        localStorage.removeItem(COMPLIMENTARY_RETURN_STORAGE_KEY);
        sessionStorage.removeItem(COMPLIMENTARY_RETURN_STORAGE_KEY);
    }
    return stored;
}

/** Login pós-confirmação de e-mail com retorno codificado na URL (funciona em nova aba). */
export function buildComplimentaryLoginRedirectPath(cortesiaPath: string): string {
    return `/login?returnTo=${encodeURIComponent(cortesiaPath.trim())}`;
}

/**
 * Resolve destino cortesia: state do login tem prioridade; senão query/localStorage (pós-cadastro).
 */
export function resolveComplimentaryReturnPath(returnTo: unknown): string | null {
    if (isComplimentaryReturnPath(returnTo)) {
        return returnTo.trim();
    }
    return peekComplimentaryReturnPath();
}
