import React, { useRef } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

export interface PrintableTicketSheetProps {
    eventName: string;
    eventDate: string;
    accessType: string;
    wristbandCode: string;
    /** UUID do ingresso (valor do QR impresso — fixo) */
    scanValue: string;
    holderName?: string | null;
}

const PrintableTicketSheet: React.FC<PrintableTicketSheetProps> = ({
    eventName,
    eventDate,
    accessType,
    wristbandCode,
    scanValue,
    holderName,
}) => {
    const printRef = useRef<HTMLDivElement>(null);
    const formattedDate = eventDate ? formatEventDateForDisplay(eventDate) : '—';

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="space-y-4">
            <div
                ref={printRef}
                id="printable-ticket"
                className="bg-white text-black rounded-xl p-6 max-w-sm mx-auto print:shadow-none print:m-0"
            >
                <p className="text-xs text-gray-600 uppercase tracking-wide mb-1">EventFest — Ingresso</p>
                <h2 className="text-lg font-bold mb-1">{eventName}</h2>
                <p className="text-sm text-gray-700 mb-1">Data: {formattedDate}</p>
                <p className="text-sm text-gray-700 mb-4">Tipo: {accessType}</p>
                <div className="flex justify-center mb-3">
                    <QRCode value={scanValue} size={200} level="H" />
                </div>
                <p className="text-center font-mono text-sm font-semibold">{wristbandCode}</p>
                {holderName && (
                    <p className="text-center text-sm text-gray-700 mt-2">Titular: {holderName}</p>
                )}
                <p className="text-[10px] text-gray-500 text-center mt-4 leading-snug">
                    QR fixo para portaria (modo impresso). O cliente também pode usar o QR dinâmico no
                    aplicativo, se preferir.
                </p>
            </div>
            <Button
                type="button"
                onClick={handlePrint}
                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 print:hidden"
            >
                <Printer className="h-4 w-4 mr-2" />
                Imprimir ingresso
            </Button>
        </div>
    );
};

export default PrintableTicketSheet;
