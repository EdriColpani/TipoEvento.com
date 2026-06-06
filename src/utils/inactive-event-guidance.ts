import type { ManagerEvent } from '@/hooks/use-manager-events';
import type { EventTicketReadiness } from '@/hooks/use-event-ticket-readiness';
import { DEFAULT_MIN_EVENT_TICKETS } from '@/utils/company-billing-rules';

export interface InactiveEventGuidance {
    /** Quando true, preferir badge "Faltam ingressos" em vez de "Desativado". */
    showMissingTicketsStatus: boolean;
    /** Linha de destaque — sempre menciona ingressos. */
    title: string;
    hint: string;
    actionLabel?: string;
    actionPath?: string;
    secondaryActionLabel?: string;
    secondaryActionPath?: string;
}

/**
 * Texto orientativo na lista "Meus Eventos" para eventos inativos.
 */
export function getInactiveEventGuidance(
    event: ManagerEvent,
    readiness: EventTicketReadiness | undefined,
    showTicketRules: boolean,
    minRequired: number = DEFAULT_MIN_EVENT_TICKETS,
): InactiveEventGuidance | null {
    if (event.is_draft || event.is_active || event.auto_deactivated_at) {
        return null;
    }

    const isCounter = event.inventory_mode === 'counter';
    const ticketCount = readiness?.active_ticket_count;
    const min = readiness?.min_required ?? minRequired;
    const countLabel = ticketCount != null ? String(ticketCount) : '0';
    const needsMore =
        readiness?.needs_more === true ||
        (showTicketRules && ticketCount != null && ticketCount < min);

    if (!showTicketRules) {
        return {
            showMissingTicketsStatus: false,
            title: 'Evento desativado',
            hint: 'Clique em Ativar para exibir na vitrine pública.',
        };
    }

    if (needsMore) {
        if (isCounter) {
            return {
                showMissingTicketsStatus: true,
                title: 'Faltam ingressos',
                hint:
                    `Cadastre os lotes do evento com pelo menos ${min} ingressos (atual: ${countLabel}). ` +
                    `Depois valide o checklist go-live e clique em Ativar.`,
                actionLabel: 'Cadastrar lotes',
                actionPath: `/manager/events/edit/${event.id}`,
            };
        }
        return {
            showMissingTicketsStatus: true,
            title: 'Faltam ingressos',
            hint:
                `Gere os ingressos antes de ativar na vitrine (${countLabel} de ${min} exigidos). ` +
                `Use Ingressos → Gerar ingressos.`,
            actionLabel: 'Gerar ingressos',
            actionPath: '/manager/wristbands/create',
        };
    }

    if (isCounter) {
        return {
            showMissingTicketsStatus: false,
            title: 'Estoque nos lotes OK',
            hint:
                `Os ${countLabel} ingressos já estão nos lotes. Veja a coluna Estoque em Gestão de Ingressos. ` +
                `Se todos os requisitos automáticos estiverem verdes abaixo, clique em Ativar.`,
            actionLabel: 'Ver estoque',
            actionPath: '/manager/wristbands',
        };
    }

    if (ticketCount != null && ticketCount >= min) {
        return {
            showMissingTicketsStatus: false,
            title: 'Ingressos gerados',
            hint:
                `Você já tem ${countLabel} ingresso(s). ` +
                `Clique em Ativar para publicar o evento na vitrine.`,
        };
    }

    return {
        showMissingTicketsStatus: true,
        title: 'Faltam ingressos',
        hint:
            `Valide o checklist do evento, gere pelo menos ${min} ingressos em Ingressos → Gerar ingressos ` +
            `e depois clique em Ativar.`,
        actionLabel: 'Gerar ingressos',
        actionPath: '/manager/wristbands/create',
        secondaryActionLabel: 'Editar evento',
        secondaryActionPath: `/manager/events/edit/${event.id}`,
    };
}
