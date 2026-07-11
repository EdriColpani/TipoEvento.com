import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showError } from '@/utils/toast';
import { restGet } from '@/utils/supabase-rest';
import { fetchManagerPrimaryCompanyIdRest } from '@/utils/manager-scope';

export interface WristbandData {
    id: string;
    code: string;
    access_type: string;
    status: 'active' | 'used' | 'lost' | 'cancelled' | 'pending';
    created_at: string;
    event_id: string;
    inventory_mode?: 'counter' | 'unit_rows' | null;
    batch_stock_total?: number;
    batch_stock_sold?: number;
    batch_stock_reserved?: number;
    batch_stock_available?: number;
    /** Início da venda do lote (event_batches.start_date). */
    sale_start_date?: string | null;
    /** Término da venda do lote (event_batches.end_date). */
    sale_end_date?: string | null;
    events: {
        title: string;
        date: string;
        time?: string | null;
        is_active?: boolean | null;
        lifecycle_ended_at?: string | null;
    } | null;
}

type WristbandRow = {
    id: string;
    code: string;
    access_type: string;
    status: WristbandData['status'];
    created_at: string;
    event_id: string;
    events?: {
        title?: string;
        date?: string;
        time?: string | null;
        is_active?: boolean | null;
        lifecycle_ended_at?: string | null;
    } | null;
};

const fetchManagerWristbands = async (
    userId: string,
    isAdminMaster: boolean,
): Promise<WristbandData[]> => {
    if (!userId) return [];

    let path =
        'wristbands?select=id,code,access_type,status,created_at,event_id,events!event_id(title,date,time,is_active,lifecycle_ended_at)&order=created_at.desc&limit=5000';

    if (!isAdminMaster) {
        const primaryCompanyId = await fetchManagerPrimaryCompanyIdRest(userId);
        if (primaryCompanyId) {
            path += `&or=(company_id.eq.${encodeURIComponent(primaryCompanyId)},manager_user_id.eq.${encodeURIComponent(userId)})`;
        } else {
            path += `&manager_user_id=eq.${encodeURIComponent(userId)}`;
        }
    }

    const data = await restGet<WristbandRow[]>(path, 20_000);
    const wristbands: WristbandData[] = (data ?? []).map((w) => ({
        ...w,
        events: w.events
            ? {
                  title: w.events.title || '',
                  date: w.events.date || '',
                  time: w.events.time ?? null,
                  is_active: w.events.is_active,
                  lifecycle_ended_at: w.events.lifecycle_ended_at ?? null,
              }
            : null,
    }));

    if (wristbands.length === 0) return [];

    const eventIds = [...new Set(wristbands.map((w) => w.event_id).filter(Boolean))];
    let counterEventIds = new Set<string>();
    let linkedCounterWristbandIds = new Set<string>();
    const stockByWristbandId: Record<
        string,
        { total: number; sold: number; reserved: number; available: number }
    > = {};
    const saleDatesByWristbandId: Record<string, { start: string | null; end: string | null }> = {};
    const inventoryModeByEventId: Record<string, string | null> = {};

    if (eventIds.length > 0) {
        const inEvents = eventIds.map(encodeURIComponent).join(',');
        try {
            const eventRows = await restGet<Array<{ id: string; inventory_mode?: string | null }>>(
                `events?select=id,inventory_mode&id=in.(${inEvents})`,
                12_000,
            );
            for (const e of eventRows ?? []) {
                inventoryModeByEventId[e.id] = e.inventory_mode ?? null;
            }
            counterEventIds = new Set(
                (eventRows ?? [])
                    .filter((e) => e.inventory_mode === 'counter')
                    .map((e) => e.id),
            );
        } catch {
            /* modo inventário opcional */
        }

        if (counterEventIds.size > 0) {
            const inCounter = [...counterEventIds].map(encodeURIComponent).join(',');
            try {
                const batchRows = await restGet<
                    Array<{
                        id: string;
                        wristband_id?: string | null;
                        event_id: string;
                        start_date?: string | null;
                        end_date?: string | null;
                    }>
                >(
                    `event_batches?select=id,wristband_id,event_id,start_date,end_date&event_id=in.(${inCounter})&wristband_id=not.is.null&limit=2000`,
                    12_000,
                );
                linkedCounterWristbandIds = new Set(
                    (batchRows ?? []).map((b) => b.wristband_id).filter(Boolean) as string[],
                );
                const batchIds = (batchRows ?? []).map((b) => b.id).filter(Boolean);
                const wristbandIdByBatchId = Object.fromEntries(
                    (batchRows ?? [])
                        .filter((b) => b.wristband_id)
                        .map((b) => [b.id, b.wristband_id as string]),
                );

                for (const b of batchRows ?? []) {
                    if (!b.wristband_id) continue;
                    saleDatesByWristbandId[b.wristband_id] = {
                        start: b.start_date ?? null,
                        end: b.end_date ?? null,
                    };
                }

                if (batchIds.length > 0) {
                    const inBatches = batchIds.map(encodeURIComponent).join(',');
                    const invRows = await restGet<
                        Array<{ batch_id: string; total?: number; sold?: number; reserved?: number }>
                    >(
                        `batch_inventory?select=batch_id,total,sold,reserved&batch_id=in.(${inBatches})&limit=2000`,
                        12_000,
                    );
                    for (const inv of invRows ?? []) {
                        const wristbandId = wristbandIdByBatchId[inv.batch_id];
                        if (!wristbandId) continue;
                        const total = Number(inv.total ?? 0);
                        const sold = Number(inv.sold ?? 0);
                        const reserved = Number(inv.reserved ?? 0);
                        stockByWristbandId[wristbandId] = {
                            total,
                            sold,
                            reserved,
                            available: Math.max(total - sold - reserved, 0),
                        };
                    }
                }
            } catch {
                /* estoque counter opcional */
            }
        }

        for (const w of wristbands) {
            const mode = inventoryModeByEventId[w.event_id];
            if (mode === 'counter' || mode === 'unit_rows') {
                w.inventory_mode = mode;
            }
        }
    }

    const scopedWristbands = wristbands.filter((w) => {
        if (!counterEventIds.has(w.event_id)) return true;
        return linkedCounterWristbandIds.has(w.id);
    });

    const wristbandIds = scopedWristbands.map((w) => w.id);
    let soldSet = new Set<string>();
    if (wristbandIds.length > 0) {
        try {
            const inWb = wristbandIds.map(encodeURIComponent).join(',');
            const soldAnalytics = await restGet<Array<{ wristband_id: string }>>(
                `wristband_analytics?select=wristband_id&wristband_id=in.(${inWb})&client_user_id=not.is.null&limit=10000`,
                15_000,
            );
            soldSet = new Set((soldAnalytics ?? []).map((a) => a.wristband_id));
        } catch {
            /* status vendido opcional */
        }
    }

    return scopedWristbands.map((w) => {
        const stock = stockByWristbandId[w.id];
        const saleDates = saleDatesByWristbandId[w.id];
        const base: WristbandData = {
            ...w,
            sale_start_date: saleDates?.start ?? null,
            sale_end_date: saleDates?.end ?? null,
            ...(stock
                ? {
                      batch_stock_total: stock.total,
                      batch_stock_sold: stock.sold,
                      batch_stock_reserved: stock.reserved,
                      batch_stock_available: stock.available,
                  }
                : {}),
        };
        return soldSet.has(w.id) ? { ...base, status: 'used' as const } : base;
    });
};

export const useManagerWristbands = (userId: string | undefined, isAdminMaster: boolean) => {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['managerWristbands', userId, isAdminMaster],
        queryFn: async () => {
            try {
                return await fetchManagerWristbands(userId!, isAdminMaster);
            } catch (error) {
                console.error('Query Error:', error);
                showError('Erro ao carregar lista de ingressos.');
                return [];
            }
        },
        enabled: !!userId,
        staleTime: 1000 * 30,
        retry: 1,
        placeholderData: [],
    });

    return {
        ...query,
        wristbands: query.data || [],
        invalidateWristbands: () =>
            queryClient.invalidateQueries({
                queryKey: ['managerWristbands', userId, isAdminMaster],
            }),
    };
};
