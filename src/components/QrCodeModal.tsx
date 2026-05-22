"use client";

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Loader2, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { useEntryQrToken } from '@/hooks/use-entry-qr-token';
import { ENTRY_QR_TTL_SECONDS } from '@/constants/entry-qr';

interface QrCodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventName: string;
    eventDate: string;
    /** Texto amigável (tipo de ingresso), não o valor do QR */
    wristbandCode: string;
    /** `static`: UUID/código fixo (gestor / inscrição gratuita). `dynamic`: token EF1 rotativo. */
    mode?: 'static' | 'dynamic';
    /** Obrigatório em `dynamic` — id de wristband_analytics */
    analyticsId?: string;
    scanValue?: string;
    singleUseNotice?: boolean;
    autoCloseSeconds?: number;
}

const QrCodeModal: React.FC<QrCodeModalProps> = ({
    isOpen,
    onClose,
    eventName,
    eventDate,
    wristbandCode,
    mode = 'static',
    analyticsId,
    scanValue,
    singleUseNotice = false,
    autoCloseSeconds = 120,
}) => {
    const isDynamic = mode === 'dynamic' && Boolean(analyticsId);
    const {
        data: tokenData,
        isLoading: tokenLoading,
        isFetching: tokenFetching,
        error: tokenError,
        refetch: refetchToken,
    } = useEntryQrToken(analyticsId, isOpen && isDynamic);

    const qrCodeValue = isDynamic
        ? (tokenData?.token ?? '')
        : (scanValue ?? wristbandCode).trim();

    const formattedDate =
        eventDate && !Number.isNaN(new Date(eventDate).getTime())
            ? format(new Date(eventDate), 'dd/MM/yyyy')
            : '—';

    const [secondsLeft, setSecondsLeft] = useState(ENTRY_QR_TTL_SECONDS);

    useEffect(() => {
        if (!isOpen || !autoCloseSeconds) return;
        const closeTimer = window.setTimeout(() => onClose(), autoCloseSeconds * 1000);
        return () => window.clearTimeout(closeTimer);
    }, [isOpen, autoCloseSeconds, onClose]);

    useEffect(() => {
        if (!isOpen || !isDynamic || !tokenData?.expiresAt) return;
        const tick = () => {
            const exp = new Date(tokenData.expiresAt).getTime();
            const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
            setSecondsLeft(left);
        };
        tick();
        const interval = window.setInterval(tick, 1000);
        return () => window.clearInterval(interval);
    }, [isOpen, isDynamic, tokenData?.expiresAt, tokenData?.token]);

    const watermarkTime = format(new Date(), 'HH:mm:ss');
    const showQr = !isDynamic || (qrCodeValue.length > 0 && !tokenLoading);

    const statusHint = useMemo(() => {
        if (!isDynamic) return null;
        if (tokenLoading) return 'Gerando QR seguro…';
        if (tokenError) return null;
        if (tokenFetching) return 'Atualizando QR…';
        return `Válido por ~${secondsLeft}s`;
    }, [isDynamic, tokenLoading, tokenError, tokenFetching, secondsLeft]);

    return (
        <AlertDialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-yellow-400 text-xl text-center">
                        QR Code de entrada
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400 text-center">
                        {isDynamic
                            ? 'QR dinâmico — apresente na portaria. Renova automaticamente.'
                            : 'Apresente na hora da entrada.'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col items-center justify-center p-4">
                    {isDynamic && tokenError && (
                        <div className="mb-4 w-full flex flex-col items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                            <WifiOff className="h-5 w-5" />
                            <p className="text-center">
                                {tokenError instanceof Error ? tokenError.message : 'Erro ao gerar QR.'}
                            </p>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-yellow-500/30 text-yellow-500"
                                onClick={() => refetchToken()}
                            >
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Tentar novamente
                            </Button>
                        </div>
                    )}

                    <div className="relative bg-white p-2 rounded-lg shadow-lg select-none min-h-[260px] min-w-[260px] flex items-center justify-center">
                        {showQr ? (
                            <>
                                <QRCode value={qrCodeValue} size={256} level="H" />
                                <div
                                    className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-lg"
                                    aria-hidden
                                >
                                    <span
                                        className="text-[10px] font-semibold text-black/25 whitespace-nowrap rotate-[-24deg]"
                                        style={{ letterSpacing: '0.15em' }}
                                    >
                                        EventFest · {watermarkTime}
                                        {isDynamic ? ` · ${secondsLeft}s` : ''}
                                    </span>
                                </div>
                            </>
                        ) : (
                            <Loader2 className="h-10 w-10 animate-spin text-yellow-600" />
                        )}
                    </div>

                    {statusHint && (
                        <p className="mt-2 text-xs text-yellow-500/90 flex items-center gap-1">
                            {tokenFetching && <Loader2 className="h-3 w-3 animate-spin" />}
                            {statusHint}
                        </p>
                    )}

                    <div className="mt-6 text-center">
                        <p className="text-lg font-semibold text-white">{eventName}</p>
                        <p className="text-sm text-gray-300">Data: {formattedDate}</p>
                        <p className="text-sm text-gray-300">Ingresso: {wristbandCode}</p>
                    </div>
                    {singleUseNotice && (
                        <div className="mt-4 flex gap-2 items-start rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-xs text-amber-200/90">
                            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                            <p>
                                <strong>Uso único na entrada:</strong> após a primeira leitura na portaria este
                                ingresso não aceita nova entrada.
                                {isDynamic
                                    ? ` O QR renova a cada ${ENTRY_QR_TTL_SECONDS}s — capturas antigas não funcionam.`
                                    : ' Não compartilhe capturas de tela.'}
                                {autoCloseSeconds > 0 ? ` Este painel fecha em ${autoCloseSeconds}s.` : ''}
                            </p>
                        </div>
                    )}
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
