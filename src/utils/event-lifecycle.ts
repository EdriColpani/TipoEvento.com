import { getEventStartDateTime } from '@/utils/event-sales-window';

/** Dias após o início (date+time) para considerar o evento encerrado operacionalmente. */
export const EVENT_LIFECYCLE_END_GRACE_DAYS = 1;

/** Instante em que o evento deixa de ser editável/reativável pelo gestor (início + 1 dia). */
export function getEventLifecycleEndDateTime(
    dateStr: string | null | undefined,
    timeStr: string | null | undefined,
): Date | null {
    const start = getEventStartDateTime(dateStr, timeStr);
    if (!start) return null;
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + EVENT_LIFECYCLE_END_GRACE_DAYS);
    return end;
}

/** `true` quando já passou 1 dia do horário de início do evento. */
export function isEventLifecycleEnded(
    dateStr: string | null | undefined,
    timeStr: string | null | undefined,
    now: Date = new Date(),
): boolean {
    const end = getEventLifecycleEndDateTime(dateStr, timeStr);
    if (!end) return false;
    return now.getTime() >= end.getTime();
}
