/** sessionStorage para fluxo "criar evento": idempotência e rascunho após INSERT. */

export const managerCreateEventDraftKey = (userId: string) => `ef_evt_draft_${userId}`;
export const managerCreateEventClientSubmitKey = (userId: string) => `ef_evt_client_submit_${userId}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fallbackUuidV4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const rnd = Math.random() * 16 | 0;
        const val = ch === 'x' ? rnd : (rnd & 0x3) | 0x8;
        return val.toString(16);
    });
}

function generateClientSubmitId(): string {
    const safeCrypto = globalThis.crypto as Crypto | undefined;
    if (safeCrypto && typeof safeCrypto.randomUUID === 'function') {
        return safeCrypto.randomUUID();
    }
    return fallbackUuidV4();
}

export function readManagerCreateEventDraftId(userId: string): string | undefined {
    try {
        const raw = sessionStorage.getItem(managerCreateEventDraftKey(userId));
        if (raw && UUID_RE.test(raw)) return raw;
    } catch {
        /* private mode */
    }
    return undefined;
}

/** Gera ou reutiliza o UUID desta aba para o 1º INSERT (único no banco). Síncrono antes de qualquer await. */
export function getOrCreateClientSubmitId(userId: string): string {
    const k = managerCreateEventClientSubmitKey(userId);
    try {
        let v = sessionStorage.getItem(k);
        if (!v || !UUID_RE.test(v)) {
            v = generateClientSubmitId();
            sessionStorage.setItem(k, v);
        }
        return v;
    } catch {
        return generateClientSubmitId();
    }
}

export function persistManagerCreateEventDraftId(userId: string, eventId: string): void {
    try {
        sessionStorage.setItem(managerCreateEventDraftKey(userId), eventId);
    } catch {
        /* private mode */
    }
}

export function clearManagerCreateEventSession(userId: string): void {
    try {
        sessionStorage.removeItem(managerCreateEventDraftKey(userId));
        sessionStorage.removeItem(managerCreateEventClientSubmitKey(userId));
    } catch {
        /* private mode */
    }
}
