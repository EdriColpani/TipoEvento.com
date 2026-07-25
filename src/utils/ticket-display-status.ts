import type { TicketData } from '@/hooks/use-my-tickets';
import { isBefore, startOfDay } from 'date-fns';
import { parseEventLocalDay } from '@/utils/format-event-date';

/** QR de entrada só no dia do evento ou antes (após a data do evento o código não vale mais). */
export function isEventDateStillValidForEntryQr(dateStr: string | null | undefined): boolean {
    const eventDay = parseEventLocalDay(dateStr);
    if (!eventDay) return true;
    return !isBefore(startOfDay(eventDay), startOfDay(new Date()));
}

/**
 * Ingresso em "Ativos" vs "Histórico":
 * - Evento com data já passada → histórico
 * - cancelled/lost → histórico
 * - active/pending → ativos (se evento ainda vigente)
 * - used (compra) com evento ainda vigente → ativos (já usou na porta, mas o evento não encerrou)
 */
export function isTicketActiveForDisplay(ticket: TicketData): boolean {
    if (ticket.status === 'cancelled' || ticket.status === 'lost') return false;

    const eventDate = ticket.wristbands?.events?.date;
    if (eventDate && !isEventDateStillValidForEntryQr(eventDate)) {
        return false;
    }

    if (ticket.status === 'active' || ticket.status === 'pending') return true;
    if (ticket.status === 'used' && ticket.event_type === 'purchase') return true;
    return false;
}

/**
 * QR dinâmico: liberado com status `active` (pré-portaria) ou `used` (já entrou —
 * ainda precisa abrir o QR no app/navegador para consumo dentro do evento).
 * A portaria bloqueia 2ª entrada em `validate-ticket`, não aqui.
 */
export function canShowEntryQrCode(ticket: {
    status: TicketData['status'];
}): boolean {
    return ticket.status === 'active' || ticket.status === 'used';
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
