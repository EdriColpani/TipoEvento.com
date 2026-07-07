import { isBefore, startOfDay } from 'date-fns';
import { parseEventLocalDay } from '@/utils/format-event-date';

export type ManagerEventStatusLabel =
    | 'Rascunho'
    | 'Inatividade comercial'
    | 'Faltam ingressos'
    | 'Desativado'
    | 'Encerrado'
    | 'Publicado'
    | 'Pendente'
    | 'Cancelado';

const STATUS_CLASSES: Record<ManagerEventStatusLabel, string> = {
    Rascunho: 'bg-gray-500/20 text-gray-400',
    'Inatividade comercial': 'bg-red-500/20 text-red-300',
    'Faltam ingressos': 'bg-amber-500/20 text-amber-300',
    Desativado: 'bg-orange-500/20 text-orange-300',
    Encerrado: 'bg-slate-500/20 text-slate-300',
    Publicado: 'bg-green-500/20 text-green-400',
    Pendente: 'bg-yellow-500/20 text-yellow-400',
    Cancelado: 'bg-red-500/20 text-red-400',
};

/** Evento já passou da data (ou do horário de início, no mesmo dia). */
export function isEventDatePassed(
    dateStr: string | null | undefined,
    timeStr?: string | null,
): boolean {
    const eventDay = parseEventLocalDay(dateStr);
    if (!eventDay) return false;

    const today = startOfDay(new Date());
    const day = startOfDay(eventDay);

    if (isBefore(day, today)) return true;

    if (!timeStr) return false;

    const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return false;

    const now = new Date();
    const start = new Date(eventDay);
    start.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return now >= start;
}

export function getManagerEventStatusPresentation(input: {
    is_draft?: boolean | null;
    is_active?: boolean | null;
    auto_deactivated_at?: string | null;
    needs_more_tickets?: boolean;
    date?: string | null;
    time?: string | null;
    status?: string | null;
}): { label: ManagerEventStatusLabel; classes: string } {
    if (input.is_draft === true) {
        return { label: 'Rascunho', classes: STATUS_CLASSES.Rascunho };
    }

    const legacyStatus = String(input.status ?? '').toLowerCase().trim();
    if (legacyStatus === 'pending') {
        return { label: 'Pendente', classes: STATUS_CLASSES.Pendente };
    }
    if (legacyStatus === 'cancelled' || legacyStatus === 'canceled') {
        return { label: 'Cancelado', classes: STATUS_CLASSES.Cancelado };
    }

    if (input.is_active === false) {
        if (input.auto_deactivated_at) {
            return { label: 'Inatividade comercial', classes: STATUS_CLASSES['Inatividade comercial'] };
        }
        if (input.needs_more_tickets) {
            return { label: 'Faltam ingressos', classes: STATUS_CLASSES['Faltam ingressos'] };
        }
        return { label: 'Desativado', classes: STATUS_CLASSES.Desativado };
    }

    if (isEventDatePassed(input.date, input.time)) {
        return { label: 'Encerrado', classes: STATUS_CLASSES.Encerrado };
    }

    return { label: 'Publicado', classes: STATUS_CLASSES.Publicado };
}

/** Rótulo simples (relatórios / exportações). */
export function resolveManagerEventStatusLabel(input: {
    is_draft?: boolean | null;
    is_active?: boolean | null;
    auto_deactivated_at?: string | null;
    needs_more_tickets?: boolean;
    date?: string | null;
    time?: string | null;
    status?: string | null;
}): ManagerEventStatusLabel {
    return getManagerEventStatusPresentation(input).label;
}
