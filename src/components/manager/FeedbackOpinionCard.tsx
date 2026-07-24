import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RATING_LABELS, ratingStarsLabel } from '@/utils/event-review';
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import {
    FEEDBACK_TAG_LABELS,
    type ManagerFeedbackItem,
} from '@/utils/manager-feedback-filters';
import { cn } from '@/lib/utils';

function formatWhen(iso: string) {
    try {
        return new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

export function FeedbackFilterChip({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                active
                    ? 'border-yellow-500 bg-yellow-500 text-black'
                    : 'border-yellow-500/30 bg-black/60 text-gray-300 hover:bg-yellow-500/10 hover:text-yellow-400',
            )}
        >
            {children}
        </button>
    );
}

export function FeedbackOpinionCard({ item }: { item: ManagerFeedbackItem }) {
    return (
        <Card className="bg-black border border-yellow-500/30 rounded-2xl">
            <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-yellow-500 font-bold text-base">
                        {ratingStarsLabel(item.rating)}
                    </span>
                    <span className="text-gray-400 text-xs font-semibold">
                        {RATING_LABELS[item.rating] ?? ''}
                    </span>
                </div>
                <p className="text-white font-semibold">{item.event_title}</p>
                <p className="text-gray-500 text-xs">
                    {item.event_date ? formatEventDateForDisplay(item.event_date) || '—' : '—'}
                    {' · '}
                    {formatWhen(item.updated_at || item.created_at)}
                </p>
                {item.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {item.tags.map((tag) => (
                            <span
                                key={`${item.id}-${tag}`}
                                className="rounded-full border border-yellow-500/20 bg-black/40 px-2.5 py-1 text-[11px] text-gray-300"
                            >
                                {FEEDBACK_TAG_LABELS[tag] ?? tag}
                            </span>
                        ))}
                    </div>
                ) : null}
                {item.comment?.trim() ? (
                    <div className="rounded-xl border border-yellow-500/20 bg-black/50 p-3 space-y-1">
                        <p className="text-yellow-500 text-[11px] font-bold uppercase tracking-wide">
                            Opinião do cliente
                        </p>
                        <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                            {item.comment.trim()}
                        </p>
                    </div>
                ) : (
                    <p className="text-gray-500 text-xs italic">Sem comentário — apenas nota e temas.</p>
                )}
            </CardContent>
        </Card>
    );
}
