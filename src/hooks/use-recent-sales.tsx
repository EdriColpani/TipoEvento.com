import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { restGet } from '@/utils/supabase-rest';

interface RecentSaleData {
    id: string;
    event_title: string;
    tickets_sold: number;
    total_value: number;
    sale_date: string;
    status: string;
}

type ReceivableRow = {
    id: string;
    created_at: string;
    total_value: number;
    status?: string;
    wristband_analytics_ids?: unknown;
    events?: { title?: string } | null;
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

async function fetchRecentSales(
    limit: number,
    userId?: string,
    isAdminMaster: boolean = false,
): Promise<RecentSaleData[]> {
    const scope =
        !isAdminMaster && userId
            ? `&manager_user_id=eq.${encodeURIComponent(userId)}`
            : '';

    const sales = await restGet<ReceivableRow[]>(
        `receivables?select=id,created_at,total_value,status,wristband_analytics_ids,events(title)&${PAID_OR}${scope}&order=created_at.desc&limit=${limit}`,
        12_000,
    );

    return (sales ?? []).map((sale) => ({
        id: sale.id,
        event_title: sale.events?.title || 'Evento sem nome',
        tickets_sold: Array.isArray(sale.wristband_analytics_ids)
            ? sale.wristband_analytics_ids.length
            : 0,
        total_value: Number(sale.total_value ?? 0),
        sale_date: format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm'),
        status: 'Confirmado',
    }));
}

export const useRecentSales = (
    limit: number = 5,
    userId?: string,
    isAdminMaster: boolean = false,
) => {
    return useQuery<RecentSaleData[]>({
        queryKey: ['recentSales', limit, userId, isAdminMaster],
        queryFn: () => fetchRecentSales(limit, userId, isAdminMaster),
        enabled: !!userId || isAdminMaster,
        staleTime: 1000 * 60,
        retry: 1,
        placeholderData: [],
    });
};
