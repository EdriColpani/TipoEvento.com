/**
 * Normaliza quantidade de ingressos do lote.
 * Aceita "50000", "50.000" (milhar BR) ou "50,000" (milhar US).
 */
export function parseBatchQuantity(value: string | number | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
        return raw.replace(/\./g, '');
    }

    if (/^\d{1,3}(,\d{3})+$/.test(raw)) {
        return raw.replace(/,/g, '');
    }

    if (/^\d+$/.test(raw)) {
        return raw;
    }

    return raw.replace(/[^\d]/g, '');
}

export function isValidBatchQuantity(value: string | number | null | undefined, max?: number): boolean {
    const normalized = parseBatchQuantity(value);
    if (!normalized || !/^[1-9]\d*$/.test(normalized)) {
        return false;
    }
    if (max != null && Number(normalized) > max) {
        return false;
    }
    return true;
}

export function batchQuantityAsNumber(value: string | number | null | undefined): number {
    return Number(parseBatchQuantity(value)) || 0;
}
