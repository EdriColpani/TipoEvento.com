import { useQuery } from '@tanstack/react-query';
import { restGet } from '@/utils/supabase-rest';
import { getSaoPauloDayBounds } from '@/utils/sao-paulo-day-bounds';

export type ManagerDashboardTodayData = {
    dayKey: string;
    participants: number;
    consumption: number;
    ticketsSold: number;
    avgTicket: number;
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

const EMPTY: ManagerDashboardTodayData = {
    dayKey: '',
    participants: 0,
    consumption: 0,
    ticketsSold: 0,
    avgTicket: 0,
};

type SaleRow = {
    total_value?: number;
    wristband_analytics_ids?: unknown;
};

type CreditSpendRow = {
    gross_amount?: number;
};

type MovementRow = {
    wristband_id: string;
};

type EventRow = {
    id: string;
};

function countTickets(ids: unknown): number {
    return Array.isArray(ids) ? ids.length : 0;
}

async function fetchManagerEventIds(
    userId?: string,
    isAdminMaster = false,
): Promise<string[]> {
    const scope =
        !isAdminMaster && userId
            ? `&created_by=eq.${encodeURIComponent(userId)}`
            : '';
    const rows = await restGet<EventRow[]>(
        `events?select=id${scope}&limit=500`,
        12_000,
    );
    return (rows ?? []).map((e) => e.id).filter(Boolean);
}

async function fetchParticipantsToday(
    eventIds: string[],
    startIso: string,
    endIso: string,
): Promise<number> {
    if (eventIds.length === 0) return 0;

    const inList = eventIds.map(encodeURIComponent).join(',');
    const rows = await restGet<MovementRow[]>(
        `wristband_movements?select=wristband_id` +
            `&event_id=in.(${inList})` +
            `&movement_type=eq.entry` +
            `&validated_at=gte.${encodeURIComponent(startIso)}` +
            `&validated_at=lte.${encodeURIComponent(endIso)}` +
            `&limit=10000`,
        12_000,
    );

    const unique = new Set((rows ?? []).map((r) => r.wristband_id).filter(Boolean));
    return unique.size;
}

async function fetchPaidSalesToday(
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
        `receivables?select=total_value,wristband_analytics_ids&${PAID_OR}${scope}` +
            `&created_at=gte.${encodeURIComponent(startIso)}` +
            `&created_at=lte.${encodeURIComponent(endIso)}` +
            `&limit=5000`,
        12_000,
    );
}

async function fetchCreditSpendsToday(
    companyId: string,
    startIso: string,
    endIso: string,
): Promise<CreditSpendRow[]> {
    return restGet<CreditSpendRow[]>(
        `credit_spend_orders?select=gross_amount` +
            `&receiver_company_id=eq.${encodeURIComponent(companyId)}` +
            `&status=eq.completed` +
            `&created_at=gte.${encodeURIComponent(startIso)}` +
            `&created_at=lte.${encodeURIComponent(endIso)}` +
            `&limit=5000`,
        12_000,
    );
}

async function fetchManagerDashboardToday(params: {
    userId?: string;
    companyId?: string;
    isAdminMaster?: boolean;
    includeCredit?: boolean;
}): Promise<ManagerDashboardTodayData> {
    const { dayKey, startIso, endIso } = getSaoPauloDayBounds();

    const [eventIds, sales, creditSpends] = await Promise.all([
        fetchManagerEventIds(params.userId, params.isAdminMaster).catch(() => [] as string[]),
        fetchPaidSalesToday(startIso, endIso, params.userId, params.isAdminMaster).catch(
            () => [] as SaleRow[],
        ),
        params.includeCredit && params.companyId
            ? fetchCreditSpendsToday(params.companyId, startIso, endIso).catch(
                  () => [] as CreditSpendRow[],
              )
            : Promise.resolve([] as CreditSpendRow[]),
    ]);

    const participants = await fetchParticipantsToday(eventIds, startIso, endIso).catch(() => 0);

    const ticketRevenue = (sales ?? []).reduce((sum, r) => sum + Number(r.total_value ?? 0), 0);
    const creditRevenue = creditSpends.reduce((sum, r) => sum + Number(r.gross_amount ?? 0), 0);
    const consumption = ticketRevenue + creditRevenue;
    const ticketsSold = (sales ?? []).reduce(
        (sum, r) => sum + countTickets(r.wristband_analytics_ids),
        0,
    );
    const avgTicket = ticketsSold > 0 ? consumption / ticketsSold : 0;

    return {
        dayKey,
        participants,
        consumption,
        ticketsSold,
        avgTicket,
    };
}

export function useManagerDashboardToday(options: {
    userId?: string;
    companyId?: string;
    isAdminMaster?: boolean;
    includeCredit?: boolean;
    enabled?: boolean;
}) {
    const {
        userId,
        companyId,
        isAdminMaster = false,
        includeCredit = false,
        enabled = true,
    } = options;

    return useQuery<ManagerDashboardTodayData>({
        queryKey: [
            'managerDashboardToday',
            userId,
            companyId,
            isAdminMaster,
            includeCredit,
        ],
        queryFn: async () => {
            try {
                return await fetchManagerDashboardToday({
                    userId,
                    companyId,
                    isAdminMaster,
                    includeCredit,
                });
            } catch {
                return EMPTY;
            }
        },
        enabled: enabled && (!!userId || isAdminMaster),
        staleTime: 1000 * 60 * 2,
        retry: 1,
        placeholderData: EMPTY,
    });
}
