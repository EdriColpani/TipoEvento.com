import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
import { WALLET_QR_REFRESH_MS, walletQrRefreshMs } from '@/constants/wallet-qr';

export type WalletQrTokenData = {
    token: string;
    expiresAt: string;
    refreshInSeconds: number;
    ttlSeconds: number;
};

async function fetchWalletQrToken(): Promise<WalletQrTokenData> {
    const { data, error } = await supabase.functions.invoke('issue-wallet-qr-token', { body: {} });
    if (error) {
        throw new Error(await parseEdgeFunctionError(error, data));
    }
    if (!data?.token) {
        throw new Error('Não foi possível gerar o QR da carteira.');
    }
    return data as WalletQrTokenData;
}

export function useWalletQrToken(enabled: boolean) {
    return useQuery({
        queryKey: ['walletQrToken'],
        queryFn: fetchWalletQrToken,
        enabled,
        refetchInterval: (query) => {
            if (!enabled) return false;
            const ttl = query.state.data?.ttlSeconds;
            if (ttl) return walletQrRefreshMs(ttl);
            const refreshSec = query.state.data?.refreshInSeconds;
            if (refreshSec) return refreshSec * 1000;
            return WALLET_QR_REFRESH_MS;
        },
        staleTime: 30_000,
        retry: 2,
    });
}
