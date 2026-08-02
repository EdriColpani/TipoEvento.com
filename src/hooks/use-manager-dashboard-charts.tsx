import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { restGet } from '@/utils/supabase-rest';

export type DashboardTicketsTrendPoint = {
    date: string;
    count: number;
};

export type DashboardChannelKey = 'online' | 'pos' | 'partners';

export type DashboardChannelSlice = {
    channel: DashboardChannelKey;
    label: string;
    amount: number;
    percent: number;
};

export type ManagerDashboardChartsData = {
    ticketsTrend: DashboardTicketsTrendPoint[];
    salesByChannel: DashboardChannelSlice[];
    periodDays: number;
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

const CHANNEL_LABELS: Record<DashboardChannelKey, string> = {
    online: 'Online',
    pos: 'Ponto / PDV',
    partners: 'Parceiros',
};

type SaleRow = {
    created_at: string;
    total_value?: number;
    wristband_analytics_ids?: unknown;
};

type CreditSpendRow = {
    created_at: string;
    gross_amount?: number;
    channel?: string | null;
    receiver_establishment_id?: string | null;
    receiver_event_id?: string | null;
    status?: string | null;
};

const EMPTY: ManagerDashboardChartsData = {
    ticketsTrend: [],
    salesByChannel: [
        { channel: 'online', label: CHANNEL_LABELS.online, amount: 0, percent: 0 },
        { channel: 'pos', label: CHANNEL_LABELS.pos, amount: 0, percent: 0 },
        { channel: 'partners', label: CHANNEL_LABELS.partners, amount: 0, percent: 0 },
    ],
    periodDays: 45,
};

function buildDateKeys(days: number): string[] {
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
        keys.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
    }
    return keys;
}

function countTickets(ids: unknown): number {
    return Array.isArray(ids) ? ids.length : 0;
}

function buildChannelSlices(amounts: Record<DashboardChannelKey, number>): DashboardChannelSlice[] {
    const total = amounts.online + amounts.pos + amounts.partners;
    return (Object.keys(CHANNEL_LABELS) as DashboardChannelKey[]).map((channel) => {
        const amount = amounts[channel];
        return {
            channel,
            label: CHANNEL_LABELS[channel],
            amount,
            percent: total > 0 ? (amount / total) * 100 : 0,
        };
    });
}

async function fetchPaidSalesWindow(
    startIso: string,
    endIso: string,
    userId?: string,
    isAdminMaster = false,
): Promise<SaleRow[]> {
    const scope =
        !isAdminMaster && userId
            ? `&manager_user_id=eq.${encodeURIComponent(userId)}`
            : '';
    return restGet<SaleRow[]>(
        `receivables?select=created_at,total_value,wristband_analytics_ids&${PAID_OR}${scope}` +
            `&created_at=gte.${encodeURIComponent(startIso)}` +
            `&created_at=lte.${encodeURIComponent(endIso)}` +
            `&order=created_at.asc&limit=5000`,
        12_000,
    );
}

async function fetchCreditSpendsWindow(
    companyId: string,
    startIso: string,
    endIso: string,
): Promise<CreditSpendRow[]> {
    return restGet<CreditSpendRow[]>(
        `credit_spend_orders?select=created_at,gross_amount,channel,receiver_establishment_id,receiver_event_id,status` +
            `&receiver_company_id=eq.${encodeURIComponent(companyId)}` +
            `&status=eq.completed` +
            `&created_at=gte.${encodeURIComponent(startIso)}` +
            `&created_at=lte.${encodeURIComponent(endIso)}` +
            `&order=created_at.asc&limit=5000`,
        12_000,
    );
}

function classifyCreditSpend(row: CreditSpendRow): DashboardChannelKey {
    const channel = (row.channel || 'web').toLowerCase();
    if (channel === 'pos') return 'pos';
    if (row.receiver_establishment_id) return 'partners';
    return 'online';
}

async function fetchManagerDashboardCharts(params: {
    userId?: string;
    companyId?: string;
    isAdminMaster?: boolean;
    includeCredit?: boolean;
    periodDays?: number;
}): Promise<ManagerDashboardChartsData> {
    const periodDays = params.periodDays ?? 45;
    const start = `${format(subDays(new Date(), periodDays - 1), 'yyyy-MM-dd')}T00:00:00-03:00`;
    const end = `${format(new Date(), 'yyyy-MM-dd')}T23:59:59.999-03:00`;

    const [sales, creditSpends] = await Promise.all([
        fetchPaidSalesWindow(start, end, params.userId, params.isAdminMaster),
        params.includeCredit && params.companyId
            ? fetchCreditSpendsWindow(params.companyId, start, end).catch(() => [] as CreditSpendRow[])
            : Promise.resolve([] as CreditSpendRow[]),
    ]);

    const dateKeys = buildDateKeys(periodDays);
    const ticketsMap = new Map(dateKeys.map((d) => [d, 0]));

    let online = 0;
    for (const sale of sales ?? []) {
        const day = format(new Date(sale.created_at), 'yyyy-MM-dd');
        if (ticketsMap.has(day)) {
            ticketsMap.set(day, (ticketsMap.get(day) || 0) + countTickets(sale.wristband_analytics_ids));
        }
        online += Number(sale.total_value ?? 0);
    }

    let pos = 0;
    let partners = 0;
    for (const spend of creditSpends) {
        const amount = Number(spend.gross_amount ?? 0);
        const bucket = classifyCreditSpend(spend);
        if (bucket === 'pos') pos += amount;
        else if (bucket === 'partners') partners += amount;
        else online += amount;
    }

    return {
        periodDays,
        ticketsTrend: dateKeys.map((date) => ({
            date,
            count: ticketsMap.get(date) || 0,
        })),
        salesByChannel: buildChannelSlices({ online, pos, partners }),
    };
}

export function useManagerDashboardCharts(options: {
    userId?: string;
    companyId?: string;
    isAdminMaster?: boolean;
    includeCredit?: boolean;
    periodDays?: number;
    enabled?: boolean;
}) {
    const {
        userId,
        companyId,
        isAdminMaster = false,
        includeCredit = false,
        periodDays = 45,
        enabled = true,
    } = options;

    return useQuery<ManagerDashboardChartsData>({
        queryKey: [
            'managerDashboardCharts',
            userId,
            companyId,
            isAdminMaster,
            includeCredit,
            periodDays,
        ],
        queryFn: async () => {
            try {
                return await fetchManagerDashboardCharts({
                    userId,
                    companyId,
                    isAdminMaster,
                    includeCredit,
                    periodDays,
                });
            } catch {
                return EMPTY;
            }
        },
        enabled: enabled && (!!userId || isAdminMaster),
        staleTime: 1000 * 60 * 5,
        retry: 1,
        placeholderData: EMPTY,
    });
}
