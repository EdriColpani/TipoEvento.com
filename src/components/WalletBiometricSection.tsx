import React, { useEffect, useState } from 'react';
import { Fingerprint, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWalletBiometric } from '@/hooks/use-wallet-biometric';
import { showError, showSuccess } from '@/utils/toast';

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type WalletBiometricSectionProps = {
    threshold: number;
    userId?: string;
    userLabel?: string;
};

const WalletBiometricSection: React.FC<WalletBiometricSectionProps> = ({
    threshold,
    userId,
    userLabel,
}) => {
    const bio = useWalletBiometric(threshold, userId, userLabel);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || !bio.supported || threshold <= 0) {
        return null;
    }

    const handleRegister = async () => {
        try {
            await bio.register();
            showSuccess('Biometria ativada para pagamentos com crédito.');
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Não foi possível ativar biometria.');
        }
    };

    const handleRemove = () => {
        bio.unregister();
        showSuccess('Biometria desativada neste aparelho.');
    };

    return (
        <Card className="bg-black border-yellow-500/30 mb-6">
            <CardHeader>
                <CardTitle className="text-lg text-white flex items-center gap-2">
                    <Fingerprint className="h-5 w-5 text-yellow-500" />
                    Confirmação biométrica
                </CardTitle>
                <CardDescription className="text-gray-400 text-sm">
                    Pagamentos a partir de {formatMoney(threshold)} pedem Face ID / digital neste aparelho
                    (opcional, recomendado no celular).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {bio.registered ? (
                    <div className="flex items-start gap-2 text-green-400 text-sm">
                        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>Biometria ativa neste dispositivo.</span>
                    </div>
                ) : (
                    <p className="text-gray-500 text-sm">
                        Proteja compras com crédito EventFest no app instalado no celular.
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    {!bio.registered ? (
                        <Button
                            type="button"
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                            disabled={bio.busy || !userId}
                            onClick={handleRegister}
                        >
                            {bio.busy ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Fingerprint className="h-4 w-4 mr-2" />
                            )}
                            Ativar biometria
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            className="border-red-500/40 text-red-400"
                            disabled={bio.busy}
                            onClick={handleRemove}
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remover neste aparelho
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default WalletBiometricSection;
