/** Formata número para exibição em pt-BR (ex.: 299.9 → "299,90"). */
export function formatCurrencyBrInput(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return '';
    return value.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

/**
 * Permite digitar valores monetários com vírgula ou ponto (máx. 2 decimais).
 * Ex.: "299,99", "1.299,99" (milhar com ponto), "299.99"
 */
export function sanitizeCurrencyBrInput(raw: string): string {
    let v = raw.replace(/[^\d,.]/g, '');
    if (!v) return '';

    const lastComma = v.lastIndexOf(',');
    const lastDot = v.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
        if (lastComma > lastDot) {
            v = v.replace(/\./g, '');
        } else {
            v = v.replace(/,/g, '');
        }
    }

    const sep = v.includes(',') ? ',' : v.includes('.') ? '.' : null;
    if (!sep) return v;

    const [intPart, ...rest] = v.split(sep);
    const decPart = rest.join('').replace(/\D/g, '').slice(0, 2);
    return decPart.length > 0 ? `${intPart}${sep}${decPart}` : `${intPart}${sep}`;
}

/** Converte "299,99" / "1.299,99" / "299.99" para número. */
export function parseCurrencyBr(value: string): number {
    const trimmed = value.trim();
    if (!trimmed) return NaN;

    const normalized = trimmed.includes(',')
        ? trimmed.replace(/\./g, '').replace(',', '.')
        : trimmed;

    return parseFloat(normalized);
}

export function isValidCurrencyBr(value: string): boolean {
    const n = parseCurrencyBr(value);
    return !Number.isNaN(n) && n >= 0;
}
