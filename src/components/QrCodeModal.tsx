"use client";

import React from 'react';
import QRCode from 'react-qr-code';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

interface QrCodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventName: string;
    eventDate: string; // Já vem como string 'YYYY-MM-DD'
    wristbandCode: string;
}

const QrCodeModal: React.FC<QrCodeModalProps> = ({
    isOpen,
    onClose,
    eventName,
    eventDate,
    wristbandCode,
}) => {
    // A string a ser codificada no QR Code
    // Usaremos um formato simples: "EVENTO|DATA|CODIGO"
    const qrCodeValue = `${eventName}|${eventDate}|${wristbandCode}`;
    const formattedDate = format(new Date(eventDate), 'dd/MM/yyyy'); // Formata para exibição

    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-yellow-400 text-xl text-center">QR Code da Pulseira</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400 text-center">
                        Escaneie este código para validar a pulseira.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col items-center justify-center p-4">
                    <div className="bg-white p-2 rounded-lg shadow-lg">
                        <QRCode value={qrCodeValue} size={256} level="H" />
                    </div>
                    <div className="mt-6 text-center">
                        <p className="text-lg font-semibold text-white">{eventName}</p>
                        <p className="text-sm text-gray-300">Data: {formattedDate}</p>
                        <p className="text-sm text-gray-300">Código: {wristbandCode}</p>
                    </div>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button
                            variant="outline"
                            className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 w-full"
                        >
                            Fechar
                        </Button>
                    </AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default QrCodeModal;

