import { useQuery } from '@tanstack/react-query';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { restGet } from '@/utils/supabase-rest';
import { subDays, format } from 'date-fns';

interface SalesMetrics {
    currentMonthTotalSales: number;
    previousMonthTotalSales: number;
    salesPercentageChange: number;
    currentMonthTicketsSold: number;
    previousMonthTicketsSold: number;
    ticketsPercentageChange: number;
}

interface EventMetrics {
    activeEvents: number;
    totalEvents: number;
}

interface OccupancyMetrics {
    occupancyRate: number;
    totalWristbandsGenerated: number;
    totalTicketsSold: number;
}

export interface DashboardData {
    sales: SalesMetrics;
    events: EventMetrics;
    occupancy: OccupancyMetrics;
}

const EMPTY_DASHBOARD: DashboardData = {
    sales: {
        currentMonthTotalSales: 0,
        previousMonthTotalSales: 0,
        salesPercentageChange: 0,
        currentMonthTicketsSold: 0,
        previousMonthTicketsSold: 0,
        ticketsPercentageChange: 0,
    },
    events: { activeEvents: 0, totalEvents: 0 },
    occupancy: { occupancyRate: 0, totalWristbandsGenerated: 0, totalTicketsSold: 0 },
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

type SaleRow = {
    total_value?: number;
    wristband_analytics_ids?: unknown;
    event_id?: string;
};

type EventRow = {
    id: string;
    is_active?: boolean | null;
    date?: string | null;
};

async function fetchPaidSales(
    start: string,
    end: string,
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<SaleRow[]> {
    const scope =
        !isAdminMaster && userId
            ? `&manager_user_id=eq.${encodeURIComponent(userId)}`
            : '';
    return restGet<SaleRow[]>(
        `receivables?select=total_value,wristband_analytics_ids,event_id&${PAID_OR}${scope}` +
            `&created_at=gte.${encodeURIComponent(start)}` +
            `&created_at=lte.${encodeURIComponent(end)}` +
            `&limit=5000`,
        12_000,
    );
}

function sumSales(rows: SaleRow[]): number {
    return rows.reduce((sum, r) => sum + Number(r.total_value ?? 0), 0);
}

function sumTickets(rows: SaleRow[]): number {
    return rows.reduce(
        (sum, r) =>
            sum + (Array.isArray(r.wristband_analytics_ids) ? r.wristband_analytics_ids.length : 0),
        0,
    );
}

const fetchDashboardData = async (
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<DashboardData> => {
    const today = new Date();
    const currentWindowStart = format(subDays(today, 30), 'yyyy-MM-dd HH:mm:ss');
    const currentWindowEnd = format(today, 'yyyy-MM-dd HH:mm:ss');
    const previousWindowStart = format(subDays(today, 60), 'yyyy-MM-dd HH:mm:ss');
    const previousWindowEnd = format(subDays(today, 31), 'yyyy-MM-dd HH:mm:ss');

    const [currentMonthSalesData, previousMonthSalesData] = await Promise.all([
        fetchPaidSales(currentWindowStart, currentWindowEnd, userId, isAdminMaster),
        fetchPaidSales(previousWindowStart, previousWindowEnd, userId, isAdminMaster),
    ]);

    const currentMonthTotalSales = sumSales(currentMonthSalesData ?? []);
    const currentMonthTicketsSold = sumTickets(currentMonthSalesData ?? []);
    const previousMonthTotalSales = sumSales(previousMonthSalesData ?? []);
    const previousMonthTicketsSold = sumTickets(previousMonthSalesData ?? []);

    const salesPercentageChange =
        previousMonthTotalSales === 0
            ? currentMonthTotalSales > 0
                ? 100
                : 0
            : ((currentMonthTotalSales - previousMonthTotalSales) / previousMonthTotalSales) * 100;

    const ticketsPercentageChange =
        previousMonthTicketsSold === 0
            ? currentMonthTicketsSold > 0
                ? 100
                : 0
            : ((currentMonthTicketsSold - previousMonthTicketsSold) / previousMonthTicketsSold) *
              100;

    const eventsScope =
        !isAdminMaster && userId
            ? `&created_by=eq.${encodeURIComponent(userId)}`
            : '';
    const eventsData = await restGet<EventRow[]>(
        `events?select=id,is_active,date${eventsScope}&limit=2000`,
        12_000,
    );

    const totalEvents = eventsData?.length ?? 0;
    const todayAdjustedForComparison = new Date();
    todayAdjustedForComparison.setHours(0, 0, 0, 0);

    const activeEvents = (eventsData ?? []).filter((event) => {
        const eventStartDate = parseEventLocalDay(event.date);
        if (!eventStartDate) return false;
        const day = new Date(
            eventStartDate.getFullYear(),
            eventStartDate.getMonth(),
            eventStartDate.getDate(),
            0,
            0,
            0,
            0,
        );
        return event.is_active !== false && day >= todayAdjustedForComparison;
    }).length;

    const eventIds = (eventsData ?? []).map((e) => e.id).filter(Boolean);
    let totalWristbandsGenerated = 0;
    let totalTicketsSold = 0;

    if (eventIds.length > 0) {
        const inList = eventIds.map(encodeURIComponent).join(',');
        try {
            const wristbands = await restGet<Array<{ id: string }>>(
                `wristbands?select=id&event_id=in.(${inList})&limit=10000`,
                12_000,
            );
            totalWristbandsGenerated = wristbands?.length ?? 0;
        } catch {
            totalWristbandsGenerated = 0;
        }

        try {
            const occupancySalesData = await restGet<SaleRow[]>(
                `receivables?select=wristband_analytics_ids,event_id&${PAID_OR}&event_id=in.(${inList})&limit=5000`,
                12_000,
            );
            totalTicketsSold = sumTickets(occupancySalesData ?? []);
        } catch {
            totalTicketsSold = 0;
        }
    }

    const rawOccupancyRate =
        totalWristbandsGenerated > 0 ? (totalTicketsSold / totalWristbandsGenerated) * 100 : 0;
    const occupancyRate = Math.max(0, Math.min(rawOccupancyRate, 100));

    return {
        sales: {
            currentMonthTotalSales,
            previousMonthTotalSales,
            salesPercentageChange,
            currentMonthTicketsSold,
            previousMonthTicketsSold,
            ticketsPercentageChange,
        },
        events: { activeEvents, totalEvents },
        occupancy: {
            occupancyRate,
            totalWristbandsGenerated,
            totalTicketsSold,
        },
    };
};

export const useDashboardData = (userId?: string, isAdminMaster: boolean = false) => {
    return useQuery<DashboardData>({
        queryKey: ['dashboardData', userId, isAdminMaster],
        queryFn: async () => {
            try {
                return await fetchDashboardData(userId, isAdminMaster);
            } catch {
                return EMPTY_DASHBOARD;
            }
        },
        enabled: !!userId || isAdminMaster,
        staleTime: 1000 * 60 * 5,
        retry: 1,
        placeholderData: EMPTY_DASHBOARD,
    });
};
