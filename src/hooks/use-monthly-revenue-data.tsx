import { useQuery } from '@tanstack/react-query';
import { format, subMonths } from 'date-fns';
import { restGet } from '@/utils/supabase-rest';

interface MonthlyRevenueDataPoint {
    month: string;
    total_revenue: number;
}

type SaleRow = {
    created_at: string;
    total_value: number;
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

const getMonthNumber = (monthAbbr: string) => {
    const monthMap: Record<string, number> = {
        Jan: 0,
        Fev: 1,
        Mar: 2,
        Abr: 3,
        Mai: 4,
        Jun: 5,
        Jul: 6,
        Ago: 7,
        Set: 8,
        Out: 9,
        Nov: 10,
        Dez: 11,
    };
    return monthMap[monthAbbr] ?? 0;
};

async function fetchMonthlyRevenueData(
    monthsBack: number,
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<MonthlyRevenueDataPoint[]> {
    const today = new Date();
    const startDate = subMonths(today, monthsBack - 1);
    const scope =
        !isAdminMaster && userId
            ? `&manager_user_id=eq.${encodeURIComponent(userId)}`
            : '';

    const salesData = await restGet<SaleRow[]>(
        `receivables?select=created_at,total_value&${PAID_OR}${scope}` +
            `&created_at=gte.${encodeURIComponent(format(startDate, 'yyyy-MM-dd HH:mm:ss'))}` +
            `&created_at=lte.${encodeURIComponent(format(today, 'yyyy-MM-dd HH:mm:ss'))}` +
            `&order=created_at.asc&limit=5000`,
        15_000,
    );

    const monthlyRevenueMap = new Map<string, number>();
    for (let i = 0; i < monthsBack; i++) {
        const date = subMonths(today, monthsBack - 1 - i);
        monthlyRevenueMap.set(format(date, 'MMM/yyyy'), 0);
    }

    for (const sale of salesData ?? []) {
        const monthKey = format(new Date(sale.created_at), 'MMM/yyyy');
        monthlyRevenueMap.set(
            monthKey,
            (monthlyRevenueMap.get(monthKey) || 0) + Number(sale.total_value ?? 0),
        );
    }

    const result: MonthlyRevenueDataPoint[] = Array.from(monthlyRevenueMap.entries()).map(
        ([month, total_revenue]) => ({ month, total_revenue }),
    );

    result.sort((a, b) => {
        const [monthA, yearA] = a.month.split('/');
        const [monthB, yearB] = b.month.split('/');
        const dateA = new Date(parseInt(yearA, 10), getMonthNumber(monthA));
        const dateB = new Date(parseInt(yearB, 10), getMonthNumber(monthB));
        return dateA.getTime() - dateB.getTime();
    });

    return result;
}

export const useMonthlyRevenueData = (
    monthsBack: number = 6,
    userId?: string,
    isAdminMaster: boolean = false,
) => {
    return useQuery<MonthlyRevenueDataPoint[]>({
        queryKey: ['monthlyRevenueData', monthsBack, userId, isAdminMaster],
        queryFn: async () => {
            try {
                return await fetchMonthlyRevenueData(monthsBack, userId, isAdminMaster);
            } catch {
                return [];
            }
        },
        enabled: !!userId || isAdminMaster,
        staleTime: 1000 * 60 * 5,
        retry: 1,
        placeholderData: [],
    });
};
