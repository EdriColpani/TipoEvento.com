import React, { useEffect, useState } from 'react';
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
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useWalletQrToken } from '@/hooks/use-wallet-qr-token';
import { WALLET_QR_DEFAULT_TTL_SECONDS } from '@/constants/wallet-qr';

interface WalletQrModalProps {
    isOpen: boolean;
    onClose: () => void;
    balanceLabel: string;
}

const WalletQrModal: React.FC<WalletQrModalProps> = ({ isOpen, onClose, balanceLabel }) => {
    const {
        data: tokenData,
        isLoading,
        isFetching,
        error,
        refetch,
    } = useWalletQrToken(isOpen);

    const qrValue = tokenData?.token ?? '';
    const displayTtl = tokenData?.ttlSeconds ?? WALLET_QR_DEFAULT_TTL_SECONDS;
    const [secondsLeft, setSecondsLeft] = useState(WALLET_QR_DEFAULT_TTL_SECONDS);

    useEffect(() => {
        if (!isOpen || !tokenData?.expiresAt) return;
        const tick = () => {
            const exp = new Date(tokenData.expiresAt).getTime();
            setSecondsLeft(Math.max(0, Math.ceil((exp - Date.now()) / 1000)));
        };
        tick();
        const id = window.setInterval(tick, 1000);
        return () => window.clearInterval(id);
    }, [isOpen, tokenData?.expiresAt]);

    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent className="bg-black border border-yellow-500/40 text-white max-w-sm">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-yellow-500">QR para pagar com crédito</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        Mostre este código no PDV do evento. Ele renova a cada {displayTtl}s por segurança.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="flex flex-col items-center gap-4 py-2">
                    {isLoading && (
                        <div className="flex items-center gap-2 text-gray-400 py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />
                            Gerando QR…
                        </div>
                    )}

                    {error && !isLoading && (
                        <div className="text-center space-y-3 py-6">
                            <ShieldAlert className="h-8 w-8 text-red-400 mx-auto" />
                            <p className="text-sm text-red-300">
                                {error instanceof Error ? error.message : 'Erro ao gerar QR.'}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="border-yellow-500/40 text-yellow-500"
                                onClick={() => refetch()}
                            >
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Tentar novamente
                            </Button>
                        </div>
                    )}

                    {!isLoading && !error && qrValue && (
                        <>
                            <div className="bg-white p-3 rounded-lg">
                                <QRCode value={qrValue} size={220} />
                            </div>
                            <p className="text-sm text-gray-300">
                                Saldo disponível: <span className="text-yellow-500 font-semibold">{balanceLabel}</span>
                            </p>
                            <p className="text-xs text-gray-500">
                                Expira em {secondsLeft}s
                                {isFetching ? ' · renovando…' : ''}
                            </p>
                        </>
                    )}
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-transparent border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10">
                        Fechar
                    </AlertDialogCancel>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default WalletQrModal;
