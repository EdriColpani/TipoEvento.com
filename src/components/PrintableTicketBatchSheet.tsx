import React, { useMemo } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

export type PrintBatchDensity = 6 | 8 | 12;

export interface PrintBatchTicketItem {
    /** UUID do analytics — valor lido pelo validador */
    scanValue: string;
    code: string;
    accessType?: string | null;
}

export interface PrintableTicketBatchSheetProps {
    eventName: string;
    eventDate: string;
    tickets: PrintBatchTicketItem[];
    density?: PrintBatchDensity;
}

const DENSITY_COLS: Record<PrintBatchDensity, number> = {
    6: 2,
    8: 2,
    12: 3,
};

const DENSITY_QR: Record<PrintBatchDensity, number> = {
    6: 140,
    8: 120,
    12: 96,
};

/**
 * Folha A4 com vários QRs de teste (Admin Master).
 * Use window.print() — CSS esconde o restante da UI no @media print.
 */
const PrintableTicketBatchSheet: React.FC<PrintableTicketBatchSheetProps> = ({
    eventName,
    eventDate,
    tickets,
    density = 8,
}) => {
    const cols = DENSITY_COLS[density];
    const qrSize = DENSITY_QR[density];
    const formattedDate = eventDate ? formatEventDateForDisplay(eventDate) : '—';

    const pages = useMemo(() => {
        const size = density;
        const chunks: PrintBatchTicketItem[][] = [];
        for (let i = 0; i < tickets.length; i += size) {
            chunks.push(tickets.slice(i, i + size));
        }
        return chunks;
    }, [tickets, density]);

    if (tickets.length === 0) {
        return (
            <p className="text-sm text-gray-400 text-center py-8">
                Nenhum ingresso selecionado para impressão.
            </p>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                <p className="text-sm text-gray-400">
                    {tickets.length} QR(s) · {pages.length} folha(s) A4 · {density} por página
                </p>
                <Button
                    type="button"
                    onClick={() => window.print()}
                    className="bg-yellow-500 text-black hover:bg-yellow-600"
                >
                    <Printer className="h-4 w-4 mr-2" />
                    Imprimir lote A4
                </Button>
            </div>

            <div id="printable-ticket-batch" className="bg-white text-black rounded-xl print:rounded-none">
                <style>{`
                    @media print {
                        @page { size: A4 portrait; margin: 8mm; }
                        body * { visibility: hidden !important; }
                        #printable-ticket-batch, #printable-ticket-batch * { visibility: visible !important; }
                        #printable-ticket-batch {
                            position: absolute !important;
                            left: 0 !important;
                            top: 0 !important;
                            width: 100% !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            background: white !important;
                            color: black !important;
                            box-shadow: none !important;
                        }
                        .print-batch-page {
                            break-after: page;
                            page-break-after: always;
                        }
                        .print-batch-page:last-child {
                            break-after: auto;
                            page-break-after: auto;
                        }
                    }
                `}</style>

                {pages.map((pageTickets, pageIdx) => (
                    <div
                        key={`page-${pageIdx}`}
                        className="print-batch-page p-3 print:p-0"
                        style={{
                            minHeight: pageIdx < pages.length - 1 ? undefined : undefined,
                        }}
                    >
                        <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-gray-300 pb-1">
                            <div>
                                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                                    EventFest — lote de teste
                                </p>
                                <p className="text-sm font-bold leading-tight">{eventName}</p>
                                <p className="text-xs text-gray-600">Data: {formattedDate}</p>
                            </div>
                            <p className="text-[10px] text-gray-500 shrink-0">
                                Folha {pageIdx + 1}/{pages.length}
                            </p>
                        </div>

                        <div
                            className="grid gap-2"
                            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                        >
                            {pageTickets.map((ticket) => (
                                <div
                                    key={ticket.scanValue}
                                    className="flex flex-col items-center rounded border border-gray-300 p-2"
                                >
                                    <QRCode value={ticket.scanValue} size={qrSize} level="M" />
                                    <p className="mt-1 font-mono text-[11px] font-semibold leading-tight text-center break-all">
                                        {ticket.code}
                                    </p>
                                    {ticket.accessType && (
                                        <p className="text-[10px] text-gray-600">{ticket.accessType}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PrintableTicketBatchSheet;
