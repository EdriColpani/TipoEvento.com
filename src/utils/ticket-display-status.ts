import type { TicketData } from '@/hooks/use-my-tickets';

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
