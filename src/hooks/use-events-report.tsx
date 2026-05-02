import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchEventsVisibleToGestor } from '@/utils/manager-events-scope';

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
}): string {
    if (row.is_draft === true) return 'Rascunho';
    const st = String(row.status ?? '').toLowerCase().trim();
    if (st === 'pending') return 'Pendente';
    if (st === 'cancelled' || st === 'canceled') return 'Cancelado';
    if (row.is_active === false) return 'Desativado';
    return 'Publicado';
}

function matchesStatusFilter(
    row: { status?: string | null; is_draft?: boolean | null; is_active?: boolean | null; date?: string | null },
    filter: string | null,
): boolean {
    if (!filter) return true;
    const label = resolveEventStatusLabel(row);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDay =
        row.date && String(row.date).trim()
            ? new Date(`${String(row.date).slice(0, 10)}T12:00:00`)
            : null;
    if (eventDay && !Number.isNaN(eventDay.getTime())) eventDay.setHours(0, 0, 0, 0);

    if (filter === 'pending') return label === 'Pendente';
    if (filter === 'active') return label === 'Publicado';
    if (filter === 'inactive') return label === 'Desativado';
    if (filter === 'finished') {
        return Boolean(eventDay && eventDay < today && label === 'Publicado');
    }
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

    const eventIds = eventRows.map((e) => e.id);
    const { data: wristbands, error: wErr } = await supabase
        .from('wristbands')
        .select('id, event_id')
        .in('event_id', eventIds);
    if (wErr) throw wErr;

    const wristbandIds = (wristbands || []).map((w: { id: string }) => w.id);
    const eventByWristband = new Map<string, string>(
        (wristbands || []).map((w: { id: string; event_id: string }) => [w.id, w.event_id]),
    );

    const generatedByEvent = new Map<string, number>();
    const soldByEvent = new Map<string, number>();
    eventIds.forEach((id) => {
        generatedByEvent.set(id, 0);
        soldByEvent.set(id, 0);
    });

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

    const rows: EventReportRow[] = [];

    for (const e of eventRows) {
        if (!matchesStatusFilter(e, filters.status)) continue;
        if (!matchesDateRange(e.date, filters.startDate, filters.endDate)) continue;

        const gen = generatedByEvent.get(e.id) || 0;
        const sold = soldByEvent.get(e.id) || 0;
        const occupancy = gen > 0 ? (sold / gen) * 100 : 0;

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
    });
};
