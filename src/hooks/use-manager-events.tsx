import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchEventsVisibleToGestorRest } from '@/utils/manager-events-scope';
import { restGet } from '@/utils/supabase-rest';

export interface ManagerEvent {
    id: string;
    title: string;
    is_draft: boolean;
    /** false = desativado (fora da vitrine / sem novas vendas). */
    is_active: boolean;
    /** Preenchido quando desativado automaticamente por inatividade comercial. */
    auto_deactivated_at?: string | null;
    date: string;
    time?: string | null;
    company_id: string;
    /** Preenchido só para Admin Master (lista global). */
    company_name?: string | null;
    inventory_mode?: 'counter' | 'unit_rows' | null;
}

/**
 * Gestor PRO: mesmos título+data+hora+empresa com mais de um id = duplicata acidental (duplo submit).
 * Mantém só o registro mais recente por `created_at` para a lista não mentir.
 * Admin master não deduplica (pode haver homônimos de gestores diferentes).
 */
function dedupeGestorRows<T extends { title: string; date: string | null; time: string | null; company_id: string | null; created_at: string }>(
    rows: T[],
): T[] {
    const keyOf = (r: T) =>
        `${(r.title || '').trim().toLowerCase()}|${r.date ?? ''}|${r.time ?? ''}|${r.company_id ?? ''}`;
    const byKey = new Map<string, T>();
    const newestFirst = [...rows].sort((a, b) => {
        const tb = new Date(b.created_at).getTime();
        const ta = new Date(a.created_at).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
        return 0;
    });
    for (const row of newestFirst) {
        const k = keyOf(row);
        if (!byKey.has(k)) byKey.set(k, row);
    }
    return Array.from(byKey.values());
}

const fetchManagerEvents = async (userId: string, isAdminMaster: boolean): Promise<ManagerEvent[]> => {
    if (!userId) {
        console.warn('Attempted to fetch manager events without a userId.');
        return [];
    }

    let rows = await fetchEventsVisibleToGestorRest(userId, isAdminMaster);
    if (!isAdminMaster) {
        rows = dedupeGestorRows(rows);
    }

    let companyNameById: Record<string, string> = {};
    if (isAdminMaster) {
        const ids = [
            ...new Set(
                rows.map((r) => r.company_id).filter((id): id is string => typeof id === 'string' && id !== ''),
            ),
        ];
        if (ids.length > 0) {
            try {
                const inList = ids.map((id) => encodeURIComponent(id)).join(',');
                const companies = await restGet<Array<{ id: string; corporate_name?: string; trade_name?: string }>>(
                    `companies?select=id,corporate_name,trade_name&id=in.(${inList})`,
                    8_000,
                );
                companyNameById = Object.fromEntries(
                    companies.map((c) => [
                        c.id,
                        String(c.trade_name || c.corporate_name || '').trim(),
                    ]),
                );
            } catch (error) {
                console.warn('[useManagerEvents] nomes de empresa indisponíveis:', error);
            }
        }
    }

    const sorted = [...rows].sort((a, b) => {
        const tb = new Date(b.created_at).getTime();
        const ta = new Date(a.created_at).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb)) {
            return tb - ta;
        }
        return (a.title || '').localeCompare(b.title || '', 'pt-BR', { sensitivity: 'base' });
    });

    return sorted.map((e) => {
        const companyId = e.company_id ?? '';
        const companyName =
            isAdminMaster && companyId ? companyNameById[companyId] || null : undefined;
        return {
            id: e.id,
            title: e.title,
            is_draft: Boolean(e.is_draft ?? false),
            is_active: e.is_active !== false,
            auto_deactivated_at: e.auto_deactivated_at ?? null,
            date: e.date ?? '',
            time: e.time ?? null,
            company_id: companyId,
            company_name: companyName,
            inventory_mode:
                e.inventory_mode === 'counter' || e.inventory_mode === 'unit_rows'
                    ? e.inventory_mode
                    : null,
        };
    });
};

export const useManagerEvents = (
    userId: string | undefined,
    isAdminMaster = false,
    options?: { enabled?: boolean },
) => {
    const queryClient = useQueryClient();

    const enabledBase =
        options?.enabled !== undefined ? Boolean(options.enabled) && !!userId : !!userId;

    const query = useQuery({
        queryKey: ['managerEvents', userId, isAdminMaster],
        queryFn: () => fetchManagerEvents(userId!, isAdminMaster),
        enabled: enabledBase,
        staleTime: 1000 * 60,
        retry: 1,
        refetchOnWindowFocus: false,
    });

    return {
        ...query,
        events: query.data || [],
        invalidateEvents: () => queryClient.invalidateQueries({ queryKey: ['managerEvents', userId, isAdminMaster] }),
    };
};
