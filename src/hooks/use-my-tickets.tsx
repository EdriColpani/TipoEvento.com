import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { isPurchasePaidForEmission } from '@/utils/ticket-display-status';

export interface TicketData {
    id: string;
    code_wristbands: string | null;
    status: 'active' | 'used' | 'lost' | 'cancelled' | 'pending';
    created_at: string;
    event_type: string;
    event_data: {
        purchase_date?: string;
        total_paid?: number;
        unit_price?: number;
        access_type?: string;
        transaction_id?: string;
    };
    wristbands: {
        access_type: string;
        price: number;
        events: {
            id: string;
            title: string;
            location: string;
            date: string;
        } | null;
    } | null;
}

/** Sem join em wristbands no PostgREST — evita recursão de RLS (erro 500). */
const FLAT_ANALYTICS_SELECT =
    'id, code_wristbands, status, created_at, event_type, event_data, wristband_id';

type EventInfo = {
    id: string;
    title: string;
    location: string;
    date: string;
};

function normalizeEvent(raw: unknown): EventInfo | null {
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as Record<string, unknown>;
    if (!e.id || !e.title) return null;
    return {
        id: String(e.id),
        title: String(e.title),
        location: String(e.location ?? ''),
        date: String(e.date ?? ''),
    };
}

function mapRpcTicket(row: Record<string, unknown>): TicketData | null {
    const wristbands = row.wristbands as Record<string, unknown> | undefined;
    const events = normalizeEvent(wristbands?.events);
    if (!events) return null;
    return {
        id: String(row.id),
        code_wristbands: (row.code_wristbands as string | null) ?? null,
        status: row.status as TicketData['status'],
        created_at: String(row.created_at),
        event_type: String(row.event_type ?? ''),
        event_data: (row.event_data as TicketData['event_data']) ?? {},
        wristbands: {
            access_type: String(wristbands?.access_type ?? 'Ingresso'),
            price: Number(wristbands?.price ?? 0),
            events,
        },
    };
}

function parseRpcPayload(data: unknown): TicketData[] {
    if (data == null) return [];
    const rows = Array.isArray(data) ? data : [];
    return rows
        .map((row) => mapRpcTicket(row as Record<string, unknown>))
        .filter((t): t is TicketData => t !== null);
}

async function fetchViaRpc(): Promise<TicketData[] | null> {
    const { data, error } = await supabase.rpc('get_my_client_tickets');
    if (error) {
        console.warn('get_my_client_tickets:', error.message, error.code);
        return null;
    }
    return parseRpcPayload(data);
}

function buildTicketFromParts(
    row: Record<string, unknown>,
    event: EventInfo,
): TicketData {
    const eventData = (row.event_data as TicketData['event_data']) ?? {};
    return {
        id: String(row.id),
        code_wristbands: (row.code_wristbands as string | null) ?? null,
        status: row.status as TicketData['status'],
        created_at: String(row.created_at),
        event_type: String(row.event_type ?? ''),
        event_data: eventData,
        wristbands: {
            access_type: eventData.access_type || 'Ingresso',
            price: Number(eventData.unit_price ?? 0),
            events: event,
        },
    };
}

async function fetchAnalyticsRows(
    userId: string,
    ids?: string[],
): Promise<Record<string, unknown>[]> {
    if (ids && ids.length > 0) {
        const { data, error } = await supabase
            .from('wristband_analytics')
            .select(FLAT_ANALYTICS_SELECT)
            .in('id', ids);
        if (error) {
            console.error('fetchAnalyticsRows by ids:', error);
            return [];
        }
        return (data || []) as Record<string, unknown>[];
    }

    const { data, error } = await supabase
        .from('wristband_analytics')
        .select(FLAT_ANALYTICS_SELECT)
        .eq('client_user_id', userId);

    if (error) {
        console.error('fetchAnalyticsRows by client:', error);
        return [];
    }
    return (data || []) as Record<string, unknown>[];
}

async function fetchViaQueries(userId: string): Promise<TicketData[]> {
    const { data: receivables, error: receivablesError } = await supabase
        .from('receivables')
        .select(`
            id,
            status,
            payment_status,
            wristband_analytics_ids,
            events:event_id (id, title, location, date)
        `)
        .eq('client_user_id', userId);

    if (receivablesError) {
        console.error('receivables for tickets:', receivablesError);
        throw receivablesError;
    }

    const eventByAnalyticsId = new Map<string, EventInfo>();
    const paidAnalyticsIds: string[] = [];

    for (const receivable of receivables || []) {
        const ev = normalizeEvent((receivable as { events?: unknown }).events);
        const ids = (receivable as { wristband_analytics_ids?: string[] | null })
            .wristband_analytics_ids;
        if (!isPurchasePaidForEmission(receivable as { status: string; payment_status: string | null })) {
            continue;
        }
        if (!Array.isArray(ids)) continue;
        for (const id of ids) {
            if (!id) continue;
            paidAnalyticsIds.push(id);
            if (ev) eventByAnalyticsId.set(id, ev);
        }
    }

    const ownedRows = await fetchAnalyticsRows(userId);
    const ownedIds = new Set(ownedRows.map((r) => String(r.id)));
    const orphanIds = [...new Set(paidAnalyticsIds.filter((id) => !ownedIds.has(id)))];
    const orphanRows = orphanIds.length > 0 ? await fetchAnalyticsRows(userId, orphanIds) : [];

    const byId = new Map<string, TicketData>();
    for (const row of [...ownedRows, ...orphanRows]) {
        const id = String(row.id);
        const event = eventByAnalyticsId.get(id);
        if (!event) continue;
        byId.set(id, buildTicketFromParts(row, event));
    }

    return [...byId.values()].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

const fetchMyTickets = async (userId: string): Promise<TicketData[]> => {
    if (!userId) return [];

    const rpcTickets = await fetchViaRpc();
    if (rpcTickets !== null && rpcTickets.length > 0) {
        return rpcTickets;
    }

    try {
        const fromQueries = await fetchViaQueries(userId);
        if (fromQueries.length > 0) {
            return fromQueries;
        }
        if (rpcTickets !== null) {
            return rpcTickets;
        }
        return fromQueries;
    } catch (queryErr) {
        console.error('fetchViaQueries failed:', queryErr);
        if (rpcTickets !== null) {
            return rpcTickets;
        }
        throw queryErr;
    }
};

/** Emite ingressos de uma compra paga (fallback do webhook). */
export async function emitReceivableTickets(receivableId: string): Promise<{
    ok: boolean;
    updated?: number;
    error?: string;
}> {
    const { data, error } = await supabase.rpc('client_emit_receivable_tickets', {
        p_receivable_id: receivableId,
    });
    if (error) {
        if (error.code === 'PGRST202') {
            return { ok: false, error: 'rpc_not_deployed' };
        }
        console.warn('client_emit_receivable_tickets:', error.message);
        return { ok: false, error: error.message };
    }
    const payload = data as { ok?: boolean; updated?: number; error?: string } | null;
    return {
        ok: Boolean(payload?.ok),
        updated: payload?.updated,
        error: payload?.error,
    };
}

export const useMyTickets = (userId: string | undefined) => {
    const query = useQuery({
        queryKey: ['myTickets', userId],
        queryFn: () => fetchMyTickets(userId!),
        enabled: !!userId,
        staleTime: 1000 * 30,
        retry: 1,
        onError: (error) => {
            console.error('Query Error: Failed to load user tickets.', error);
            showError('Erro ao carregar seus ingressos. Tente recarregar a página.');
        },
    });

    return {
        ...query,
        tickets: query.data || [],
    };
};
