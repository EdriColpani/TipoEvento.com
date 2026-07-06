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
    // Legado: algumas vendas antigas gravaram "used" ao associar a compra (antes da entrada no evento)
    if (ticket.status === 'used' && ticket.event_type === 'purchase') return true;
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
