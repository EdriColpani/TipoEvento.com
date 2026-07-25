import { useQuery } from '@tanstack/react-query';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { entryQrRefreshMs, ENTRY_QR_REFRESH_MS } from '@/constants/entry-qr';

export type EntryQrTokenData = {
    token: string;
    expiresAt: string;
    refreshInSeconds: number;
    ttlSeconds: number;
};

async function fetchEntryQrToken(analyticsId: string): Promise<EntryQrTokenData> {
    const data = await invokeEdgeFunctionRest<EntryQrTokenData & { error?: string }>(
        'issue-entry-token',
        { analyticsId },
        { timeoutMs: 12_000 },
    );
    if (!data?.token) {
        throw new Error(data?.error || 'Não foi possível gerar o QR de entrada.');
    }
    return {
        token: data.token,
        expiresAt: data.expiresAt,
        refreshInSeconds: data.refreshInSeconds,
        ttlSeconds: data.ttlSeconds,
    };
}

function isRetryableEntryQrError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error ?? '');
    if (/não liberado|não pertence|não encontrado|Sessão|obrigatório/i.test(msg)) {
        return false;
    }
    return /Tempo esgotado|AbortError|Failed to fetch|NetworkError|network/i.test(msg);
}

export function useEntryQrToken(analyticsId: string | undefined, enabled: boolean) {
    return useQuery({
        queryKey: ['entryQrToken', analyticsId],
        queryFn: () => fetchEntryQrToken(analyticsId!),
        enabled: Boolean(enabled && analyticsId),
        refetchInterval: (query) => {
            if (!enabled) return false;
            if (query.state.error) return false;
            const ttl = query.state.data?.ttlSeconds;
            if (ttl) return entryQrRefreshMs(ttl);
            const refreshSec = query.state.data?.refreshInSeconds;
            if (refreshSec) return refreshSec * 1000;
            return ENTRY_QR_REFRESH_MS;
        },
        staleTime: 15_000,
        retry: (failureCount, error) => failureCount < 1 && isRetryableEntryQrError(error),
        refetchOnWindowFocus: false,
    });
}
