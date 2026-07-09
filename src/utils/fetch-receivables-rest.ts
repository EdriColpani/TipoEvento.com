import { restGet } from '@/utils/supabase-rest';
import type { FinancialSplitRow } from '@/utils/resolve-receivable-financials';

export type ReceivableRestRow = {
    id: string;
    status: string;
    payment_status: string | null;
    mp_status_detail: string | null;
    mp_payment_id: string | null;
    total_value: number;
    gross_amount: number | null;
    mp_fee_amount: number | null;
    platform_fee_amount: number | null;
    net_amount_after_mp: number | null;
    created_at: string;
    paid_at: string | null;
    event_id: string;
    wristband_analytics_ids: string[] | null;
    events: {
        id: string;
        title: string;
        date: string;
        applied_percentage: number | null;
    } | null;
};

export type ReceivableListFilters = {
    eventId?: string;
    startDate?: string;
    endDate?: string;
    status?: 'pending' | 'paid' | 'failed';
};

type ListOptions = {
    paidOnly?: boolean;
    limit?: number;
    orderDesc?: boolean;
};

function appendDateFilters(params: string[], filters: ReceivableListFilters): void {
    if (filters.startDate) {
        params.push(`created_at=gte.${encodeURIComponent(filters.startDate)}`);
    }
    if (filters.endDate) {
        const endDateWithTime = new Date(filters.endDate);
        endDateWithTime.setHours(23, 59, 59, 999);
        params.push(`created_at=lte.${encodeURIComponent(endDateWithTime.toISOString())}`);
    }
}

function buildReceivablesPath(
    filters: ReceivableListFilters,
    userId: string | undefined,
    isAdminMaster: boolean,
    select: string,
    options: ListOptions = {},
): string {
    const params: string[] = [`select=${encodeURIComponent(select)}`];

    if (!isAdminMaster && userId) {
        params.push(`manager_user_id=eq.${encodeURIComponent(userId)}`);
    }
    if (filters.eventId) {
        params.push(`event_id=eq.${encodeURIComponent(filters.eventId)}`);
    }
    if (filters.status) {
        params.push(`status=eq.${encodeURIComponent(filters.status)}`);
    }
    if (options.paidOnly) {
        params.push('or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)');
    }
    appendDateFilters(params, filters);
    if (options.orderDesc) {
        params.push('order=created_at.desc');
    }
    if (options.limit) {
        params.push(`limit=${options.limit}`);
    }

    return `receivables?${params.join('&')}`;
}

export async function fetchReceivablesRest(
    filters: ReceivableListFilters,
    userId: string | undefined,
    isAdminMaster: boolean,
    options: ListOptions = {},
): Promise<ReceivableRestRow[]> {
    const select =
        'id,status,payment_status,mp_status_detail,mp_payment_id,total_value,gross_amount,mp_fee_amount,platform_fee_amount,net_amount_after_mp,created_at,paid_at,event_id,wristband_analytics_ids,events(id,title,date,applied_percentage)';

    const path = buildReceivablesPath(filters, userId, isAdminMaster, select, options);
    return restGet<ReceivableRestRow[]>(path, 15_000);
}

export async function fetchPaidReceivablesForReport(
    filters: ReceivableListFilters,
    userId: string | undefined,
    isAdminMaster: boolean,
): Promise<ReceivableRestRow[]> {
    const select =
        'id,total_value,gross_amount,mp_fee_amount,net_amount_after_mp,platform_fee_amount,created_at,event_id,wristband_analytics_ids,events!inner(id,title,date,applied_percentage)';

    const path = buildReceivablesPath(filters, userId, isAdminMaster, select, { paidOnly: true });
    return restGet<ReceivableRestRow[]>(path, 15_000);
}

export async function fetchFinancialSplitsRest(transactionIds: string[]): Promise<FinancialSplitRow[]> {
    if (transactionIds.length === 0) return [];

    const inList = transactionIds.map((id) => encodeURIComponent(id)).join(',');
    return restGet<FinancialSplitRow[]>(
        `financial_splits?select=transaction_id,platform_amount,manager_amount,applied_percentage&transaction_id=in.(${inList})`,
        12_000,
    );
}
