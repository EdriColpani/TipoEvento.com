import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Info, QrCode, Ticket } from 'lucide-react';
import type { TicketData } from '@/hooks/use-my-tickets';
import type { PurchaseData } from '@/hooks/use-my-purchases';
import EventInfoDialog from '@/components/EventInfoDialog';
import QrCodeModal from '@/components/QrCodeModal';

interface PurchaseTicketsPanelProps {
    purchase: PurchaseData;
    tickets: TicketData[];
    isPaid: boolean;
}

const PurchaseTicketsPanel: React.FC<PurchaseTicketsPanelProps> = ({
    purchase,
    tickets,
    isPaid,
}) => {
    const [infoOpen, setInfoOpen] = useState(false);
    const [qrTicket, setQrTicket] = useState<TicketData | null>(null);

    const event = purchase.events;

    if (!isPaid) {
        return null;
    }

    const hasTickets = tickets.length > 0;
    const pendingEmission =
        !hasTickets &&
        (purchase.wristband_analytics_ids?.length ?? 0) === 0;

    return (
        <>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-yellow-500/20 mt-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInfoOpen(true)}
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                >
                    <Info className="h-4 w-4 mr-2" />
                    Informações do evento
                </Button>
            </div>

            <div className="mt-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                    <Ticket className="h-3.5 w-3.5 text-yellow-500" />
                    Ingressos desta compra
                </p>
                {pendingEmission && (
                    <p className="text-sm text-yellow-400/90">
                        Pagamento confirmado. Os ingressos estão sendo emitidos — atualize a página em instantes ou use
                        &quot;Verificar no MP&quot;.
                    </p>
                )}
                {hasTickets ? (
                    <ul className="space-y-2">
                        {tickets.map((ticket) => {
                            const canShowQr =
                                ticket.status === 'active' || ticket.status === 'pending';
                            const typeLabel =
                                ticket.wristbands?.access_type || 'Ingresso';
                            const codeLabel =
                                (ticket.code_wristbands && ticket.code_wristbands.trim()) ||
                                ticket.id.slice(0, 8);
                            return (
                                <li
                                    key={ticket.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-yellow-500/20 bg-black/40 px-3 py-2"
                                >
                                    <div>
                                        <p className="text-white text-sm font-medium">{typeLabel}</p>
                                        <p className="text-xs text-gray-500">Código: {codeLabel}</p>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        disabled={!canShowQr}
                                        onClick={() => setQrTicket(ticket)}
                                        className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                    >
                                        <QrCode className="h-4 w-4 mr-1" />
                                        QR de entrada
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                ) : !pendingEmission ? (
                    <p className="text-sm text-gray-400">
                        Nenhum ingresso vinculado a esta compra. Confira a seção &quot;Ingressos Ativos&quot; abaixo.
                    </p>
                ) : null}
            </div>

            <EventInfoDialog
                open={infoOpen}
                onClose={() => setInfoOpen(false)}
                title={event?.title || 'Evento'}
                date={event?.date}
                location={event?.location}
                address={event?.address}
                address_lat={event?.address_lat}
                address_lng={event?.address_lng}
                description={event?.description}
            />

            {qrTicket && (
                <QrCodeModal
                    isOpen={Boolean(qrTicket)}
                    onClose={() => setQrTicket(null)}
                    eventName={event?.title || qrTicket.wristbands?.events?.title || 'Evento'}
                    eventDate={event?.date || qrTicket.wristbands?.events?.date || ''}
                    wristbandCode={qrTicket.wristbands?.access_type || 'Ingresso'}
                    mode={qrTicket.event_type === 'purchase' ? 'dynamic' : 'static'}
                    analyticsId={qrTicket.event_type === 'purchase' ? qrTicket.id : undefined}
                    scanValue={qrTicket.event_type !== 'purchase' ? qrTicket.id : undefined}
                    singleUseNotice
                    autoCloseSeconds={120}
                />
            )}
        </>
    );
};

export default PurchaseTicketsPanel;
