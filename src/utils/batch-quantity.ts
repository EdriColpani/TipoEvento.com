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

/**
 * Preço de lote em BRL digitado no form ("0,50", "1.250,00", "10.5").
 * Retorna null se inválido.
 */
export function parseBatchPriceBr(value: string | number | null | undefined): number | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    let normalized: string;
    if (raw.includes(',')) {
        normalized = raw.replace(/\./g, '').replace(',', '.');
    } else if (/^\d+(\.\d{1,2})?$/.test(raw)) {
        normalized = raw;
    } else {
        return null;
    }

    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
}

export function isValidBatchPriceBr(value: string | number | null | undefined): boolean {
    const n = parseBatchPriceBr(value);
    return n != null && n > 0;
}
