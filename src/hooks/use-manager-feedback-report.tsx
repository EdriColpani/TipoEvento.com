import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import type { ManagerFeedbackItem } from '@/utils/manager-feedback-filters';

export type ManagerFeedbackEventOption = {
    id: string;
    title: string;
    date: string | null;
};

export type ManagerFeedbackReport = {
    reviews_count: number;
    average_rating: number;
    rating_distribution: Record<string, number>;
    tag_counts: Record<string, number>;
    events: ManagerFeedbackEventOption[];
    items: ManagerFeedbackItem[];
};

function parseReport(raw: unknown): ManagerFeedbackReport {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const itemsRaw = Array.isArray(row.items) ? row.items : [];
    const eventsRaw = Array.isArray(row.events) ? row.events : [];
    const dist =
        row.rating_distribution && typeof row.rating_distribution === 'object'
            ? (row.rating_distribution as Record<string, unknown>)
            : {};
    const tags =
        row.tag_counts && typeof row.tag_counts === 'object'
            ? (row.tag_counts as Record<string, unknown>)
            : {};

    return {
        reviews_count: Number(row.reviews_count ?? 0),
        average_rating: Number(row.average_rating ?? 0),
        rating_distribution: Object.fromEntries(
            Object.entries(dist).map(([k, v]) => [k, Number(v ?? 0)]),
        ),
        tag_counts: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, Number(v ?? 0)])),
        events: eventsRaw.map((ev) => {
            const e = (ev && typeof ev === 'object' ? ev : {}) as Record<string, unknown>;
            return {
                id: String(e.id ?? ''),
                title: String(e.title ?? 'Evento'),
                date: e.date != null ? String(e.date) : null,
            };
        }),
        items: itemsRaw.map((item) => {
            const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
            return {
                id: String(r.id ?? ''),
                event_id: String(r.event_id ?? ''),
                event_title: String(r.event_title ?? 'Evento'),
                event_date: r.event_date != null ? String(r.event_date) : null,
                rating: Number(r.rating ?? 0),
                comment: r.comment != null ? String(r.comment) : null,
                tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
                created_at: String(r.created_at ?? ''),
                updated_at: String(r.updated_at ?? ''),
            };
        }),
    };
}

export function useManagerFeedbackReport(enabled = true) {
    return useQuery({
        queryKey: ['manager-feedback-report'],
        enabled,
        staleTime: 30_000,
        queryFn: async () => {
            const data = await callRpcRest<unknown>('get_manager_feedback_report', {}, 20_000);
            return parseReport(data);
        },
    });
}
