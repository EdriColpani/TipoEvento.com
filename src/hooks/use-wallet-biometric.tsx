import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
    isWalletBiometricRegistered,
    isWalletBiometricSupported,
    registerWalletBiometric,
    verifyWalletBiometric,
    clearWalletBiometric,
    requiresBiometricForAmount,
} from '@/utils/wallet-biometric';

export function useWalletBiometric(threshold: number, userId?: string, userLabel?: string) {
    const [busy, setBusy] = useState(false);

    const supported = isWalletBiometricSupported();
    const registered = userId ? isWalletBiometricRegistered(userId) : false;

    const register = useCallback(async () => {
        if (!userId) throw new Error('Faça login para ativar biometria.');
        setBusy(true);
        try {
            await registerWalletBiometric(userId, userLabel || userId);
        } finally {
            setBusy(false);
        }
    }, [userId, userLabel]);

    const verify = useCallback(async () => {
        if (!userId) throw new Error('Faça login.');
        setBusy(true);
        try {
            await verifyWalletBiometric(userId);
        } finally {
            setBusy(false);
        }
    }, [userId]);

    const unregister = useCallback(() => {
        if (userId) clearWalletBiometric(userId);
    }, [userId]);

    const needsBiometric = useCallback(
        (amount: number) => requiresBiometricForAmount(amount, threshold),
        [threshold],
    );

    const ensureForSpend = useCallback(
        async (amount: number) => {
            if (!needsBiometric(amount)) return;
            if (!registered) {
                throw new Error(
                    `Ative a biometria na Carteira EventFest para pagamentos a partir de R$ ${threshold.toFixed(2).replace('.', ',')}.`,
                );
            }
            await verify();
        },
        [needsBiometric, registered, threshold, verify],
    );

    return {
        supported,
        registered,
        busy,
        threshold,
        register,
        verify,
        unregister,
        needsBiometric,
        ensureForSpend,
    };
}

export async function getCurrentUserForBiometric(): Promise<{ id: string; label: string } | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const label = user.email ?? user.id;
    return { id: user.id, label };
}
