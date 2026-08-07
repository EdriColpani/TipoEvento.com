/** Extrai token EFDEL.* de texto livre (scan/câmera/cola). */
export function parseDeliveryQrToken(raw: string | null | undefined): string | null {
    const text = (raw ?? '').trim();
    if (!text) return null;

    const match = text.match(/EFDEL\.[A-Za-z0-9]+/i);
    if (match?.[0]) return match[0];

    if (/^[A-Za-z0-9._-]+$/.test(text) && text.toUpperCase().startsWith('EFDEL')) {
        return text;
    }

    return null;
}

export function isDeliveryQrToken(raw: string | null | undefined): boolean {
    return parseDeliveryQrToken(raw) != null;
}
