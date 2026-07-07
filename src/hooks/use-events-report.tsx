import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchEventsVisibleToGestor } from '@/utils/manager-events-scope';
import { resolveManagerEventStatusLabel } from '@/utils/manager-event-status';

export interface EventReportRow {
    event_id: string;
    event_title: string;
    /** Rótulo em português alinhado à lista de eventos do gestor */
    status: string;
    start_date: string;
    end_date: string | null;
    location: string;
    company_name: string;
    total_wristbands_generated: number;
    total_wristbands_sold: number;
    total_wristbands_remaining: number;
    occupancy_percentage: number;
}

export interface EventsReportFilters {
    eventId: string | null;
    status: string | null;
    startDate: string | null;
    endDate: string | null;
}

function chunks<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/** Mesma ideia de ManagerEventsList + coluna legacy `status` (ex.: pending). */
export function resolveEventStatusLabel(row: {
    status?: string | null;
    is_draft?: boolean | null;
    is_active?: boolean | null;
    date?: string | null;
    time?: string | null;
}): string {
    return resolveManagerEventStatusLabel(row);
}

function matchesStatusFilter(
    row: {
        status?: string | null;
        is_draft?: boolean | null;
        is_active?: boolean | null;
        date?: string | null;
        time?: string | null;
    },
    filter: string | null,
): boolean {
    if (!filter) return true;
    const label = resolveEventStatusLabel(row);

    if (filter === 'pending') return label === 'Pendente';
    if (filter === 'active') return label === 'Publicado';
    if (filter === 'inactive') return label === 'Desativado';
    if (filter === 'finished') return label === 'Encerrado';
    if (filter === 'cancelled') return label === 'Cancelado';
    return true;
}

function matchesDateRange(
    dateStr: string | null | undefined,
    startDate: string | null,
    endDate: string | null,
): boolean {
    if (!startDate && !endDate) return true;
    const d = dateStr ? String(dateStr).slice(0, 10) : '';
    if (!d) return false;
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
}

async function loadCounterInventoryByEvent(eventIds: string[]) {
    const generatedByEvent = new Map<string, number>();
    const soldByEvent = new Map<string, number>();
    const remainingByEvent = new Map<string, number>();

    eventIds.forEach((id) => {
        generatedByEvent.set(id, 0);
        soldByEvent.set(id, 0);
        remainingByEvent.set(id, 0);
    });

    if (eventIds.length === 0) {
        return { generatedByEvent, soldByEvent, remainingByEvent };
    }

    const { data, error } = await supabase
        .from('batch_inventory')
        .select('event_id, total, sold, reserved')
        .in('event_id', eventIds);

    if (error) throw error;

    for (const row of data ?? []) {
        const eventId = String(row.event_id);
        const total = Number(row.total ?? 0);
        const sold = Number(row.sold ?? 0);
        const reserved = Number(row.reserved ?? 0);
        const remaining = Math.max(total - sold - reserved, 0);

        generatedByEvent.set(eventId, (generatedByEvent.get(eventId) || 0) + total);
        soldByEvent.set(eventId, (soldByEvent.get(eventId) || 0) + sold);
        remainingByEvent.set(eventId, (remainingByEvent.get(eventId) || 0) + remaining);
    }

    return { generatedByEvent, soldByEvent, remainingByEvent };
}

async function loadLegacyAnalyticsByEvent(eventIds: string[]) {
    const generatedByEvent = new Map<string, number>();
    const soldByEvent = new Map<string, number>();

    eventIds.forEach((id) => {
        generatedByEvent.set(id, 0);
        soldByEvent.set(id, 0);
    });

    if (eventIds.length === 0) {
        return { generatedByEvent, soldByEvent };
    }

    const { data: wristbands, error: wErr } = await supabase
        .from('wristbands')
        .select('id, event_id')
        .in('event_id', eventIds);
    if (wErr) throw wErr;

    const wristbandIds = (wristbands || []).map((w: { id: string }) => w.id);
    const eventByWristband = new Map<string, string>(
        (wristbands || []).map((w: { id: string; event_id: string }) => [w.id, w.event_id]),
    );

    for (const wbChunk of chunks(wristbandIds, 250)) {
        if (wbChunk.length === 0) continue;
        const { data: analytics, error: aErr } = await supabase
            .from('wristband_analytics')
            .select('wristband_id, client_user_id')
            .in('wristband_id', wbChunk);
        if (aErr) throw aErr;
        for (const row of analytics || []) {
            const wid = (row as { wristband_id: string }).wristband_id;
            const ev = eventByWristband.get(wid);
            if (!ev) continue;
            generatedByEvent.set(ev, (generatedByEvent.get(ev) || 0) + 1);
            const cid = (row as { client_user_id: string | null }).client_user_id;
            if (cid != null && String(cid).trim() !== '') {
                soldByEvent.set(ev, (soldByEvent.get(ev) || 0) + 1);
            }
        }
    }

    return { generatedByEvent, soldByEvent };
}

export async function fetchEventsReport(
    managerUserId: string,
    isAdminMaster: boolean,
    filters: EventsReportFilters,
): Promise<EventReportRow[]> {
    const scoped = await fetchEventsVisibleToGestor(supabase, managerUserId, isAdminMaster);
    let ids = scoped.map((r) => r.id);
    if (ids.length === 0) return [];

    if (filters.eventId) {
        ids = ids.includes(filters.eventId) ? [filters.eventId] : [];
    }
    if (ids.length === 0) return [];

    const selectAttempts = [
        'id, title, date, location, company_id, status, is_active, is_draft, inventory_mode',
        'id, title, date, location, company_id, status, is_active, is_draft',
        'id, title, date, location, company_id, status, is_active',
        'id, title, date, location, company_id, is_active',
        'id, title, date, location, company_id',
    ];

    type EvRow = {
        id: string;
        title: string;
        date: string | null;
        location: string | null;
        company_id: string | null;
        status?: string | null;
        is_active?: boolean | null;
        is_draft?: boolean | null;
        inventory_mode?: string | null;
    };

    let eventRows: EvRow[] = [];
    let lastErr = '';
    for (const sel of selectAttempts) {
        const { data, error } = await supabase.from('events').select(sel).in('id', ids);
        if (error) {
            lastErr = error.message;
            continue;
        }
        eventRows = (data || []) as EvRow[];
        break;
    }
    if (eventRows.length === 0 && lastErr) {
        throw new Error(lastErr);
    }

    const companyIds = [...new Set(eventRows.map((e) => e.company_id).filter(Boolean))] as string[];
    const companyNameById = new Map<string, string>();
    if (companyIds.length > 0) {
        const { data: comps, error: cErr } = await supabase
            .from('companies')
            .select('id, corporate_name')
            .in('id', companyIds);
        if (cErr) throw cErr;
        (comps || []).forEach((c: { id: string; corporate_name: string | null }) => {
            companyNameById.set(c.id, c.corporate_name?.trim() || 'N/A');
        });
    }

    const counterEventIds = eventRows
        .filter((e) => e.inventory_mode === 'counter')
        .map((e) => e.id);
    const legacyEventIds = eventRows
        .filter((e) => e.inventory_mode !== 'counter')
        .map((e) => e.id);

    const counterStats = await loadCounterInventoryByEvent(counterEventIds);
    const legacyStats = await loadLegacyAnalyticsByEvent(legacyEventIds);

    const rows: EventReportRow[] = [];

    for (const e of eventRows) {
        if (!matchesStatusFilter(e, filters.status)) continue;
        if (!matchesDateRange(e.date, filters.startDate, filters.endDate)) continue;

        const isCounter = e.inventory_mode === 'counter';
        const gen = isCounter
            ? counterStats.generatedByEvent.get(e.id) || 0
            : legacyStats.generatedByEvent.get(e.id) || 0;
        const sold = isCounter
            ? counterStats.soldByEvent.get(e.id) || 0
            : legacyStats.soldByEvent.get(e.id) || 0;
        const remaining = isCounter
            ? counterStats.remainingByEvent.get(e.id) || 0
            : Math.max(gen - sold, 0);
        const occupancy = gen > 0 ? (sold / gen) * 100 : sold > 0 ? 100 : 0;

        rows.push({
            event_id: e.id,
            event_title: e.title?.trim() || 'Evento',
            status: resolveEventStatusLabel(e),
            start_date: e.date ? String(e.date).slice(0, 10) : '',
            end_date: null,
            location: e.location?.trim() || '—',
            company_name: e.company_id ? companyNameById.get(e.company_id) || 'N/A' : 'N/A',
            total_wristbands_generated: gen,
            total_wristbands_sold: sold,
            total_wristbands_remaining: remaining,
            occupancy_percentage: occupancy,
        });
    }

    return rows.sort((a, b) =>
        a.event_title.localeCompare(b.event_title, 'pt-BR', { sensitivity: 'base' }),
    );
}

export const useEventsReport = (
    managerUserId: string | undefined,
    isAdminMaster: boolean,
    filters: EventsReportFilters,
    enabled: boolean,
) => {
    return useQuery({
        queryKey: ['events_report', managerUserId, isAdminMaster, filters],
        queryFn: () => fetchEventsReport(managerUserId!, isAdminMaster, filters),
        enabled: Boolean(enabled && managerUserId),
        staleTime: 60_000,
        retry: 1,
    });
};
