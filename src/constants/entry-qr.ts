/** Alinhado a `entry-qr-token.ts` no backend. */
export const ENTRY_QR_PREFIX = 'EF1';
export const ENTRY_QR_DEFAULT_TTL_SECONDS = 90;
export const ENTRY_QR_ALLOWED_TTLS = [60, 90, 120] as const;
export type EntryQrTtlOption = (typeof ENTRY_QR_ALLOWED_TTLS)[number];

/** Legado — preferir valor retornado por `issue-entry-token`. */
export const ENTRY_QR_TTL_SECONDS = ENTRY_QR_DEFAULT_TTL_SECONDS;
export const ENTRY_QR_REFRESH_MS = entryQrRefreshMs(ENTRY_QR_DEFAULT_TTL_SECONDS);

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function entryQrRefreshMs(ttlSeconds: number): number {
    const ttl = ENTRY_QR_ALLOWED_TTLS.includes(ttlSeconds as EntryQrTtlOption)
        ? ttlSeconds
        : ENTRY_QR_DEFAULT_TTL_SECONDS;
    return Math.max(15_000, (ttl - 15) * 1000);
}

export const ENTRY_QR_TTL_LABELS: Record<EntryQrTtlOption, string> = {
    60: '60 segundos — mais seguro (filas rápidas)',
    90: '90 segundos — recomendado',
    120: '120 segundos — filas grandes / cidades menores',
};

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
