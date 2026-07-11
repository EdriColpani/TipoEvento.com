/** Resolve % de comissão pela quantidade de ingressos (espelho de commission_ranges). */
export type CommissionRangeLike = {
    id: string | number;
    min_tickets: number;
    max_tickets: number;
    percentage: number;
    active?: boolean;
};

export function resolveCommissionFromRanges(
    ticketQty: number,
    ranges: CommissionRangeLike[],
): { percentage: number; commission_range_id: string | number } | null {
    const qty = Math.max(1, Math.floor(Number(ticketQty) || 0));
    const active = ranges.filter((r) => r.active !== false);
    const match = active.find((r) => qty >= r.min_tickets && qty <= r.max_tickets);
    if (!match) return null;
    return {
        percentage: Number(match.percentage),
        commission_range_id: match.id,
    };
}
