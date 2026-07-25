import type { TicketData } from '@/hooks/use-my-tickets';
import { isBefore, startOfDay } from 'date-fns';
import { parseEventLocalDay } from '@/utils/format-event-date';

/** QR de entrada só no dia do evento ou antes (após a data do evento o código não vale mais). */
export function isEventDateStillValidForEntryQr(dateStr: string | null | undefined): boolean {
    const eventDay = parseEventLocalDay(dateStr);
    if (!eventDay) return true;
    return !isBefore(startOfDay(eventDay), startOfDay(new Date()));
}

/** Ingresso exibido em "Ativos" (inclui reserva pós-checkout aguardando emissão). */
export function isTicketActiveForDisplay(ticket: TicketData): boolean {
    if (ticket.status === 'cancelled' || ticket.status === 'lost') return false;
    if (ticket.status === 'active' || ticket.status === 'pending') return true;
    return false;
}

/**
 * QR dinâmico de entrada: só com status `active` (ou pending aguardando emissão).
 * Ingresso `used` já passou na portaria — não deve ficar em "Gerando QR…".
 */
export function canShowEntryQrCode(ticket: {
    status: TicketData['status'];
    event_type?: string | null;
}): boolean {
    if (ticket.status === 'active') return true;
    if (ticket.status === 'pending') return true;
    return false;
}

export function isTicketEmittedForPurchase(ticket: TicketData): boolean {
    return (
        ticket.event_type === 'purchase' &&
        (ticket.status === 'active' ||
            (ticket.status === 'used' && Boolean(ticket.event_data?.transaction_id)))
    );
}

export function isPurchasePaidForEmission(purchase: {
    status: string;
    payment_status: string | null;
}): boolean {
    return (
        purchase.status === 'paid' ||
        purchase.payment_status === 'approved' ||
        purchase.payment_status === 'authorized'
    );
}
