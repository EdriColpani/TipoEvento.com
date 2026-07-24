import { EVENT_REVIEW_TAGS } from '@/utils/event-review';

export type ManagerFeedbackItem = {
    id: string;
    event_id: string;
    event_title: string;
    event_date: string | null;
    rating: number;
    comment: string | null;
    tags: string[];
    created_at: string;
    updated_at: string;
};

export type FeedbackRatingFilter = 'all' | 1 | 2 | 3 | 4 | 5;
export type FeedbackCommentFilter = 'all' | 'with' | 'without';

export type FeedbackReportFilters = {
    eventId: string | 'all';
    rating: FeedbackRatingFilter;
    tag: string | 'all';
    comment: FeedbackCommentFilter;
    search: string;
};

export const DEFAULT_FEEDBACK_FILTERS: FeedbackReportFilters = {
    eventId: 'all',
    rating: 'all',
    tag: 'all',
    comment: 'all',
    search: '',
};

export const FEEDBACK_TAG_LABELS: Record<string, string> = Object.fromEntries(
    EVENT_REVIEW_TAGS.map((t) => [t.id, t.label]),
);

export function filterFeedbackItems(
    items: ManagerFeedbackItem[],
    filters: FeedbackReportFilters,
): ManagerFeedbackItem[] {
    const q = filters.search.trim().toLowerCase();
    return items.filter((item) => {
        if (filters.eventId !== 'all' && item.event_id !== filters.eventId) return false;
        if (filters.rating !== 'all' && item.rating !== filters.rating) return false;
        if (filters.tag !== 'all' && !item.tags.includes(filters.tag)) return false;
        if (filters.comment === 'with' && !item.comment?.trim()) return false;
        if (filters.comment === 'without' && !!item.comment?.trim()) return false;
        if (q) {
            const hay = `${item.event_title} ${item.comment ?? ''} ${item.tags.join(' ')}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

export function summarizeFilteredFeedback(items: ManagerFeedbackItem[]) {
    const count = items.length;
    const average =
        count === 0
            ? 0
            : Math.round((items.reduce((sum, i) => sum + i.rating, 0) / count) * 100) / 100;
    const withComment = items.filter((i) => !!i.comment?.trim()).length;
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const item of items) {
        const key = item.rating as 1 | 2 | 3 | 4 | 5;
        if (key >= 1 && key <= 5) distribution[key] += 1;
    }
    return { count, average, withComment, distribution };
}
