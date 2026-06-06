/** Menor preço pago (> 0) para exibição na vitrine. */
export function pickMinimumPaidPrice(candidates: Array<number | null | undefined>): number | null {
    let min = Infinity;
    for (const raw of candidates) {
        const n = typeof raw === 'number' ? raw : Number(raw ?? NaN);
        if (!Number.isFinite(n) || n <= 0) continue;
        if (n < min) min = n;
    }
    return min === Infinity ? null : min;
}

export function formatPublicMinPrice(
    price: number | null | undefined,
    isPaid: boolean,
    listingOnly?: boolean,
): string {
    if (listingOnly) return 'Divulgação';
    if (!isPaid) return 'Gratuito';
    if (price == null || price <= 0) return 'Em breve';
    return `R$ ${price.toFixed(2).replace('.', ',')}`;
}
