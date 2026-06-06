import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';

export interface WristbandData {
    id: string;
    code: string;
    access_type: string;
    status: 'active' | 'used' | 'lost' | 'cancelled';
    created_at: string;
    event_id: string;
    /** Grande porte: estoque por lote (não 1 linha = 1 ingresso). */
    inventory_mode?: 'counter' | 'unit_rows' | null;
    batch_stock_total?: number;
    batch_stock_sold?: number;
    batch_stock_reserved?: number;
    batch_stock_available?: number;

    // Dados do evento associado (join)
    events: {
        title: string;
        date: string;
    } | null;
}

const fetchManagerWristbands = async (userId: string, isAdminMaster: boolean): Promise<WristbandData[]> => {
    if (!userId) {
        console.warn("Attempted to fetch wristbands without a userId.");
        return [];
    }

    let query = supabase
        .from('wristbands')
        .select(`
            id,
            code,
            access_type,
            status,
            created_at,
            event_id,
            events!event_id (title, date) -- Adicionado: data do evento para o QR Code. Especificando relacionamento explícito via event_id para evitar erro PGRST201
        `)
        .order('created_at', { ascending: false });

    if (!isAdminMaster) {
        const primaryCompanyId = await fetchManagerPrimaryCompanyId(supabase, userId);
        if (primaryCompanyId) {
            query = query.or(`company_id.eq.${primaryCompanyId},manager_user_id.eq.${userId}`);
        } else {
            query = query.eq('manager_user_id', userId);
        }
    }
    // Se for isAdminMaster, nenhum filtro de company_id é aplicado,
    // e a RLS no banco de dados já garante o acesso total.

    const { data, error } = await query;

    if (error) {
        console.error("Error fetching manager wristbands from Supabase:", error);
        throw new Error(error.message); 
    }

    const wristbands = (data || []) as WristbandData[];
    if (wristbands.length === 0) return [];

    const eventIds = [...new Set(wristbands.map((w) => w.event_id).filter(Boolean))];
    let counterEventIds = new Set<string>();
    let linkedCounterWristbandIds = new Set<string>();
    const stockByWristbandId: Record<
        string,
        { total: number; sold: number; reserved: number; available: number }
    > = {};

    if (eventIds.length > 0) {
        const { data: eventRows } = await supabase
            .from('events')
            .select('id, inventory_mode')
            .in('id', eventIds);

        const inventoryModeByEventId = Object.fromEntries(
            (eventRows ?? []).map((e) => [e.id as string, e.inventory_mode as string | null]),
        );

        counterEventIds = new Set(
            (eventRows ?? [])
                .filter((e) => e.inventory_mode === 'counter')
                .map((e) => e.id as string),
        );

        if (counterEventIds.size > 0) {
            const { data: batchRows } = await supabase
                .from('event_batches')
                .select('id, wristband_id, event_id')
                .in('event_id', [...counterEventIds])
                .not('wristband_id', 'is', null);

            linkedCounterWristbandIds = new Set(
                (batchRows ?? [])
                    .map((b) => b.wristband_id as string)
                    .filter(Boolean),
            );

            const batchIds = (batchRows ?? []).map((b) => b.id as string).filter(Boolean);
            const wristbandIdByBatchId = Object.fromEntries(
                (batchRows ?? []).map((b) => [b.id as string, b.wristband_id as string]),
            );

            if (batchIds.length > 0) {
                const { data: invRows } = await supabase
                    .from('batch_inventory')
                    .select('batch_id, total, sold, reserved')
                    .in('batch_id', batchIds);

                for (const inv of invRows ?? []) {
                    const wristbandId = wristbandIdByBatchId[inv.batch_id as string];
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
        }

        // attach inventory_mode early for mapping below
        for (const w of wristbands) {
            const mode = inventoryModeByEventId[w.event_id];
            if (mode === 'counter' || mode === 'unit_rows') {
                (w as WristbandData).inventory_mode = mode;
            }
        }
    }

    const scopedWristbands = wristbands.filter((w) => {
        if (!counterEventIds.has(w.event_id)) return true;
        return linkedCounterWristbandIds.has(w.id);
    });

    // Regras de negócio para exibição no gestor:
    // - pulseira vendida = existe analytics com client_user_id preenchido
    // - nesse caso, mostrar status "used" (vendida) na listagem de gestão
    const wristbandIds = scopedWristbands.map((w) => w.id);
    const { data: soldAnalytics, error: soldError } = await supabase
        .from('wristband_analytics')
        .select('wristband_id')
        .in('wristband_id', wristbandIds)
        .not('client_user_id', 'is', null);

    if (soldError) {
        console.error("Error fetching sold analytics for wristbands:", soldError);
        return scopedWristbands;
    }

    const soldSet = new Set((soldAnalytics || []).map((a: { wristband_id: string }) => a.wristband_id));
    return scopedWristbands.map((w) => {
        const stock = stockByWristbandId[w.id];
        const base: WristbandData = {
            ...w,
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
        queryKey: ['managerWristbands', userId, isAdminMaster], // Adiciona isAdminMaster à chave de cache
        queryFn: () => fetchManagerWristbands(userId!, isAdminMaster),
        enabled: !!userId, // Só executa se tiver o userId
        staleTime: 1000 * 30, // 30 seconds
        onError: (error) => {
            console.error("Query Error:", error);
            showError("Erro ao carregar lista de ingressos.");
        }
    });

    return {
        ...query,
        wristbands: query.data || [],
        invalidateWristbands: () => queryClient.invalidateQueries({ queryKey: ['managerWristbands', userId, isAdminMaster] }),
    };
};