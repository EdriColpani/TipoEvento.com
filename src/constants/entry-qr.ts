/** Alinhado a `entry-qr-token.ts` no backend. */
export const ENTRY_QR_PREFIX = 'EF1';
export const ENTRY_QR_REFRESH_MS = 75_000;
export const ENTRY_QR_TTL_SECONDS = 90;

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** QR dinâmico do app (case-sensitive — não aplicar toUpperCase). */
export function isDynamicEntryQrCode(code: string): boolean {
    return code.trim().startsWith(`${ENTRY_QR_PREFIX}.`);
}

/**
 * Normaliza código para o validador: BASE-NNN em maiúsculas; EF1 e UUID preservam o texto.
 */
export function normalizeValidatorWristbandCode(code: string): string {
    const trimmed = code.trim();
    if (isDynamicEntryQrCode(trimmed)) return trimmed;
    if (UUID_RE.test(trimmed)) return trimmed;
    return trimmed.toUpperCase();
}
