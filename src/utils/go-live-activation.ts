import type { GoLiveChecklist, GoLiveChecklistItem } from '@/hooks/use-event-go-live-checklist';

/** Itens automáticos obrigatórios que impedem ativação na vitrine. */
export function getGoLiveAutoBlockers(items: GoLiveChecklistItem[] | undefined): GoLiveChecklistItem[] {
    return (items ?? []).filter((item) => {
        if (item.kind !== 'auto' || !item.required) return false;
        return item.status === 'fail';
    });
}

export function isGoLiveAutoReady(checklist: GoLiveChecklist | null | undefined): boolean {
    if (!checklist?.applies) return true;
    return getGoLiveAutoBlockers(checklist.items).length === 0;
}

export function getGoLiveFixAction(
    itemKey: string,
    eventId: string,
): { label: string; path: string } | null {
    switch (itemKey) {
        case 'mp_configured':
            return { label: 'Configurar Mercado Pago', path: '/manager/settings/advanced' };
        case 'inventory_configured':
        case 'counter_mode':
        case 'async_webhook':
            return { label: 'Editar evento', path: `/manager/events/edit/${eventId}` };
        case 'inventory_integrity':
            return { label: 'Ver estoque', path: '/manager/wristbands' };
        default:
            return { label: 'Abrir checklist', path: `/manager/events/edit/${eventId}` };
    }
}
