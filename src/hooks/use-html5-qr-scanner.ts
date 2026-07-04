import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { showError } from '@/utils/toast';

const SCAN_CONFIG = { fps: 10, qrbox: { width: 250, height: 250 } as { width: number; height: number } };

export function useHtml5QrScanner(readerElementId: string) {
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const [isScanning, setIsScanning] = useState(false);

    const stopScanning = useCallback(async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
                await scannerRef.current.clear();
            } catch {
                // scanner já parado
            }
            scannerRef.current = null;
        }
        setIsScanning(false);
    }, []);

    const startScanning = useCallback(
        async (onDecode: (text: string) => void | Promise<void>) => {
            if (scannerRef.current) {
                await stopScanning();
            }

            setIsScanning(true);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

            const el = document.getElementById(readerElementId);
            if (!el) {
                showError('Erro ao inicializar scanner. Atualize a página e tente de novo.');
                setIsScanning(false);
                return;
            }

            try {
                const html5QrCode = new Html5Qrcode(readerElementId);
                scannerRef.current = html5QrCode;

                const onSuccess = async (decodedText: string) => {
                    try {
                        await html5QrCode.stop();
                    } catch {
                        // ignore
                    }
                    scannerRef.current = null;
                    setIsScanning(false);
                    await onDecode(decodedText.trim());
                };

                try {
                    await html5QrCode.start({ facingMode: 'environment' }, SCAN_CONFIG, onSuccess, () => {});
                } catch {
                    await html5QrCode.start({ facingMode: 'user' }, SCAN_CONFIG, onSuccess, () => {});
                }
            } catch (error: unknown) {
                console.error('[useHtml5QrScanner]', error);
                const msg = error instanceof Error ? error.message : String(error);
                showError(
                    msg.includes('Permission') || msg.includes('NotAllowed')
                        ? 'Permissão da câmera negada. Permita o acesso nas configurações do navegador.'
                        : 'Não foi possível abrir a câmera. Use HTTPS, permita a câmera ou digite o código manualmente.',
                );
                setIsScanning(false);
                scannerRef.current = null;
            }
        },
        [readerElementId, stopScanning],
    );

    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(() => {});
                scannerRef.current.clear().catch(() => {});
            }
        };
    }, []);

    return { isScanning, startScanning, stopScanning };
}
