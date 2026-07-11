import { useQuery } from '@tanstack/react-query';
import { subDays, format } from 'date-fns';
import { restGet } from '@/utils/supabase-rest';

interface DailySales {
    date: string;
    total_sales: number;
}

type SaleRow = {
    created_at: string;
    total_value: number;
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

const fetchDailySales = async (
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<DailySales[]> => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const today = format(new Date(), 'yyyy-MM-dd');
    const scope =
        !isAdminMaster && userId
            ? `&manager_user_id=eq.${encodeURIComponent(userId)}`
            : '';

    const data = await restGet<SaleRow[]>(
        `receivables?select=created_at,total_value&${PAID_OR}${scope}` +
            `&created_at=gte.${encodeURIComponent(thirtyDaysAgo + 'T00:00:00Z')}` +
            `&created_at=lte.${encodeURIComponent(today + 'T23:59:59Z')}` +
            `&order=created_at.asc&limit=5000`,
        12_000,
    );

    const salesMap = new Map<string, number>();
    for (let i = 0; i <= 30; i++) {
        salesMap.set(format(subDays(new Date(), i), 'yyyy-MM-dd'), 0);
    }

    for (const sale of data ?? []) {
        const saleDate = format(new Date(sale.created_at), 'yyyy-MM-dd');
        salesMap.set(saleDate, (salesMap.get(saleDate) || 0) + Number(sale.total_value ?? 0));
    }

    return Array.from(salesMap.entries())
        .map(([date, total_sales]) => ({ date, total_sales }))
        .sort((a, b) => a.date.localeCompare(b.date));
};

export const useSalesChartData = (userId?: string, isAdminMaster: boolean = false) => {
    return useQuery<DailySales[]>({
        queryKey: ['dailySalesData', userId, isAdminMaster],
        queryFn: async () => {
            try {
                return await fetchDailySales(userId, isAdminMaster);
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
