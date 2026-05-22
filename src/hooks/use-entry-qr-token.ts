import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
import { entryQrRefreshMs, ENTRY_QR_REFRESH_MS } from '@/constants/entry-qr';

export type EntryQrTokenData = {
    token: string;
    expiresAt: string;
    refreshInSeconds: number;
    ttlSeconds: number;
};

async function fetchEntryQrToken(analyticsId: string): Promise<EntryQrTokenData> {
    const { data, error } = await supabase.functions.invoke('issue-entry-token', {
        body: { analyticsId },
    });
    if (error) {
        throw new Error(await parseEdgeFunctionError(error, data));
    }
    if (!data?.token) {
        throw new Error('Não foi possível gerar o QR de entrada.');
    }
    return data as EntryQrTokenData;
}

export function useEntryQrToken(analyticsId: string | undefined, enabled: boolean) {
    return useQuery({
        queryKey: ['entryQrToken', analyticsId],
        queryFn: () => fetchEntryQrToken(analyticsId!),
        enabled: Boolean(enabled && analyticsId),
        refetchInterval: (query) => {
            if (!enabled) return false;
            const ttl = query.state.data?.ttlSeconds;
            if (ttl) return entryQrRefreshMs(ttl);
            const refreshSec = query.state.data?.refreshInSeconds;
            if (refreshSec) return refreshSec * 1000;
            return ENTRY_QR_REFRESH_MS;
        },
        staleTime: 30_000,
        retry: 2,
    });
}
