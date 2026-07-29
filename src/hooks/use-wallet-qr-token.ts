import { useQuery } from '@tanstack/react-query';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { WALLET_QR_REFRESH_MS, walletQrRefreshMs } from '@/constants/wallet-qr';

export type WalletQrTokenData = {
    token: string;
    expiresAt: string;
    refreshInSeconds: number;
    ttlSeconds: number;
};

async function fetchWalletQrToken(): Promise<WalletQrTokenData> {
    const data = await invokeEdgeFunctionRest<WalletQrTokenData & { error?: string }>(
        'issue-wallet-qr-token',
        {},
        { timeoutMs: 12_000 },
    );
    if (!data?.token) {
        throw new Error(data?.error || 'Não foi possível gerar o QR da carteira.');
    }
    return {
        token: data.token,
        expiresAt: data.expiresAt,
        refreshInSeconds: data.refreshInSeconds,
        ttlSeconds: data.ttlSeconds,
    };
}

function isRetryableWalletQrError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error ?? '');
    if (/não autorizado|sessão|carteira não está ativa|indisponível/i.test(msg)) {
        return false;
    }
    return /tempo esgotado|aborterror|failed to fetch|networkerror|network/i.test(msg.toLowerCase());
}

export function useWalletQrToken(enabled: boolean) {
    return useQuery({
        queryKey: ['walletQrToken'],
        queryFn: fetchWalletQrToken,
        enabled,
        refetchInterval: (query) => {
            if (!enabled) return false;
            if (query.state.error) return false;
            const ttl = query.state.data?.ttlSeconds;
            if (ttl) return walletQrRefreshMs(ttl);
            const refreshSec = query.state.data?.refreshInSeconds;
            if (refreshSec) return refreshSec * 1000;
            return WALLET_QR_REFRESH_MS;
        },
        staleTime: 15_000,
        retry: (failureCount, error) => failureCount < 1 && isRetryableWalletQrError(error),
        refetchOnWindowFocus: false,
    });
}
