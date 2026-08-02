import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { restGet } from '@/utils/supabase-rest';
import {
    BRAZIL_UF_CODES,
    normalizeBrazilUf,
    type BrazilUfCode,
} from '@/utils/brazil-uf';

export type DashboardAccessByUf = {
    uf: BrazilUfCode;
    count: number;
};

export type ManagerDashboardAccessMapData = {
    periodDays: number;
    byUf: DashboardAccessByUf[];
    topUfs: DashboardAccessByUf[];
    knownTickets: number;
    unknownTickets: number;
    coveragePercent: number;
};

const PAID_OR =
    'or=(status.eq.paid,payment_status.eq.approved,payment_status.eq.authorized)';

const EMPTY: ManagerDashboardAccessMapData = {
    periodDays: 45,
    byUf: BRAZIL_UF_CODES.map((uf) => ({ uf, count: 0 })),
    topUfs: [],
    knownTickets: 0,
    unknownTickets: 0,
    coveragePercent: 0,
};

type SaleRow = {
    client_user_id?: string | null;
    wristband_analytics_ids?: unknown;
};

type ProfileRow = {
    id: string;
    estado?: string | null;
};

function countTickets(ids: unknown): number {
    return Array.isArray(ids) ? ids.length : 0;
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

async function fetchPaidSalesWithClients(
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
        `receivables?select=client_user_id,wristband_analytics_ids&${PAID_OR}${scope}` +
            `&created_at=gte.${encodeURIComponent(startIso)}` +
            `&created_at=lte.${encodeURIComponent(endIso)}` +
            `&limit=5000`,
        12_000,
    );
}

async function fetchProfilesEstado(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (userIds.length === 0) return map;

    for (const group of chunk(userIds, 80)) {
        const inList = group.map(encodeURIComponent).join(',');
        const rows = await restGet<ProfileRow[]>(
            `profiles?select=id,estado&id=in.(${inList})&limit=500`,
            12_000,
        );
        for (const row of rows ?? []) {
            map.set(row.id, String(row.estado || ''));
        }
    }
    return map;
}

async function fetchAccessByUf(params: {
    userId?: string;
    isAdminMaster?: boolean;
    periodDays?: number;
}): Promise<ManagerDashboardAccessMapData> {
    const periodDays = params.periodDays ?? 45;
    const start = `${format(subDays(new Date(), periodDays - 1), 'yyyy-MM-dd')}T00:00:00-03:00`;
    const end = `${format(new Date(), 'yyyy-MM-dd')}T23:59:59.999-03:00`;

    const sales = await fetchPaidSalesWithClients(
        start,
        end,
        params.userId,
        params.isAdminMaster,
    );

    const ticketsByClient = new Map<string, number>();
    let orphanTickets = 0;

    for (const sale of sales ?? []) {
        const n = countTickets(sale.wristband_analytics_ids) || 1;
        const clientId = sale.client_user_id ? String(sale.client_user_id) : '';
        if (!clientId) {
            orphanTickets += n;
            continue;
        }
        ticketsByClient.set(clientId, (ticketsByClient.get(clientId) || 0) + n);
    }

    const profiles = await fetchProfilesEstado([...ticketsByClient.keys()]);
    const counts = new Map<BrazilUfCode, number>();
    for (const uf of BRAZIL_UF_CODES) counts.set(uf, 0);

    let knownTickets = 0;
    let unknownTickets = orphanTickets;

    for (const [clientId, tickets] of ticketsByClient) {
        const uf = normalizeBrazilUf(profiles.get(clientId));
        if (!uf) {
            unknownTickets += tickets;
            continue;
        }
        counts.set(uf, (counts.get(uf) || 0) + tickets);
        knownTickets += tickets;
    }

    const byUf = BRAZIL_UF_CODES.map((uf) => ({
        uf,
        count: counts.get(uf) || 0,
    }));
    const topUfs = [...byUf]
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const total = knownTickets + unknownTickets;
    return {
        periodDays,
        byUf,
        topUfs,
        knownTickets,
        unknownTickets,
        coveragePercent: total > 0 ? (knownTickets / total) * 100 : 0,
    };
}

export function useManagerDashboardAccessMap(options: {
    userId?: string;
    isAdminMaster?: boolean;
    periodDays?: number;
    enabled?: boolean;
}) {
    const {
        userId,
        isAdminMaster = false,
        periodDays = 45,
        enabled = true,
    } = options;

    return useQuery<ManagerDashboardAccessMapData>({
        queryKey: ['managerDashboardAccessMap', userId, isAdminMaster, periodDays],
        queryFn: async () => {
            try {
                return await fetchAccessByUf({ userId, isAdminMaster, periodDays });
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
