import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export interface CommissionSeriesPoint {
    bucket_date: string;
    ticket_commission: number;
    consumption_event_commission: number;
    consumption_partner_commission: number;
    total_commission: number;
}

export interface CommissionSeriesSummary {
    ticket_commission: number;
    consumption_event_commission: number;
    consumption_partner_commission: number;
    consumption_commission: number;
    total_commission: number;
}

export interface AdminCommissionSeries {
    items: CommissionSeriesPoint[];
    summary: CommissionSeriesSummary;
}

const EMPTY_SUMMARY: CommissionSeriesSummary = {
    ticket_commission: 0,
    consumption_event_commission: 0,
    consumption_partner_commission: 0,
    consumption_commission: 0,
    total_commission: 0,
};

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function mapSeries(raw: Record<string, unknown> | null): AdminCommissionSeries {
    const rawItems = Array.isArray(raw?.items) ? (raw?.items as Record<string, unknown>[]) : [];
    const rawSummary = (raw?.summary ?? {}) as Record<string, unknown>;

    return {
        items: rawItems.map((row) => ({
            bucket_date: String(row.bucket_date ?? ''),
            ticket_commission: toNumber(row.ticket_commission),
            consumption_event_commission: toNumber(row.consumption_event_commission),
            consumption_partner_commission: toNumber(row.consumption_partner_commission),
            total_commission: toNumber(row.total_commission),
        })),
        summary: {
            ticket_commission: toNumber(rawSummary.ticket_commission),
            consumption_event_commission: toNumber(rawSummary.consumption_event_commission),
            consumption_partner_commission: toNumber(rawSummary.consumption_partner_commission),
            consumption_commission: toNumber(rawSummary.consumption_commission),
            total_commission: toNumber(rawSummary.total_commission),
        },
    };
}

/** Série dos últimos 30 dias de comissões da plataforma (ingresso + consumo) — Admin Master. */
export function useAdminCommissionSeries(enabled: boolean) {
    const query = useQuery<AdminCommissionSeries>({
        queryKey: ['adminCommissionSeries'],
        queryFn: async () => {
            const raw = await callRpcRest<Record<string, unknown>>(
                'get_admin_commission_daily_series',
                { p_start_date: null, p_end_date: null },
                20_000,
            );
            return mapSeries(raw);
        },
        enabled,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });

    return {
        items: query.data?.items ?? [],
        summary: query.data?.summary ?? EMPTY_SUMMARY,
        isLoading: query.isLoading,
        isError: query.isError,
    };
}
