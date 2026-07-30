import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { restGet } from '@/utils/supabase-rest';

export type ManagerDashboardExtraKpis = {
    checkIns: number;
    checkInsPrevious: number;
    checkInsPercentageChange: number;
    creditsConsumed: number;
    creditsPrevious: number;
    creditsPercentageChange: number;
};

const EMPTY: ManagerDashboardExtraKpis = {
    checkIns: 0,
    checkInsPrevious: 0,
    checkInsPercentageChange: 0,
    creditsConsumed: 0,
    creditsPrevious: 0,
    creditsPercentageChange: 0,
};

type EventRow = { id: string };
type MovementRow = { wristband_id: string };
type CreditSpendRow = { gross_amount?: number };

function pctChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
}

function windowBounds(daysAgoStart: number, daysAgoEnd: number) {
    return {
        start: `${format(subDays(new Date(), daysAgoStart), 'yyyy-MM-dd')}T00:00:00-03:00`,
        end: `${format(subDays(new Date(), daysAgoEnd), 'yyyy-MM-dd')}T23:59:59.999-03:00`,
    };
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

async function countUniqueCheckIns(
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
    return new Set((rows ?? []).map((r) => r.wristband_id).filter(Boolean)).size;
}

async function sumCreditSpends(
    companyId: string,
    startIso: string,
    endIso: string,
): Promise<number> {
    const rows = await restGet<CreditSpendRow[]>(
        `credit_spend_orders?select=gross_amount` +
            `&receiver_company_id=eq.${encodeURIComponent(companyId)}` +
            `&status=eq.completed` +
            `&created_at=gte.${encodeURIComponent(startIso)}` +
            `&created_at=lte.${encodeURIComponent(endIso)}` +
            `&limit=5000`,
        12_000,
    );
    return (rows ?? []).reduce((sum, r) => sum + Number(r.gross_amount ?? 0), 0);
}

async function fetchExtraKpis(params: {
    userId?: string;
    companyId?: string;
    isAdminMaster?: boolean;
    includeCredit?: boolean;
}): Promise<ManagerDashboardExtraKpis> {
    const current = windowBounds(29, 0);
    const previous = windowBounds(59, 30);

    const eventIds = await fetchManagerEventIds(params.userId, params.isAdminMaster).catch(
        () => [] as string[],
    );

    const [checkIns, checkInsPrevious, creditsConsumed, creditsPrevious] = await Promise.all([
        countUniqueCheckIns(eventIds, current.start, current.end).catch(() => 0),
        countUniqueCheckIns(eventIds, previous.start, previous.end).catch(() => 0),
        params.includeCredit && params.companyId
            ? sumCreditSpends(params.companyId, current.start, current.end).catch(() => 0)
            : Promise.resolve(0),
        params.includeCredit && params.companyId
            ? sumCreditSpends(params.companyId, previous.start, previous.end).catch(() => 0)
            : Promise.resolve(0),
    ]);

    return {
        checkIns,
        checkInsPrevious,
        checkInsPercentageChange: pctChange(checkIns, checkInsPrevious),
        creditsConsumed,
        creditsPrevious,
        creditsPercentageChange: pctChange(creditsConsumed, creditsPrevious),
    };
}

export function useManagerDashboardExtraKpis(options: {
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

    return useQuery<ManagerDashboardExtraKpis>({
        queryKey: [
            'managerDashboardExtraKpis',
            userId,
            companyId,
            isAdminMaster,
            includeCredit,
        ],
        queryFn: async () => {
            try {
                return await fetchExtraKpis({
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
        staleTime: 1000 * 60 * 5,
        retry: 1,
        placeholderData: EMPTY,
    });
}
