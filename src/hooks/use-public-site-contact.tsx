import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    DEFAULT_PUBLIC_SITE_CONTACT,
    parsePublicSiteContact,
    type PublicSiteContact,
} from '@/utils/public-site-contact';
import { callRpcPublicRest } from '@/utils/supabase-rest-rpc';

export const PUBLIC_SITE_CONTACT_QUERY_KEY = ['publicSiteContact'] as const;

async function fetchPublicSiteContact(): Promise<PublicSiteContact> {
    try {
        const data = await callRpcPublicRest<unknown>('get_public_contact_info', {}, 8_000);
        return parsePublicSiteContact(data);
    } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('function')) {
            return DEFAULT_PUBLIC_SITE_CONTACT;
        }
        console.warn('get_public_contact_info failed', e);
        return DEFAULT_PUBLIC_SITE_CONTACT;
    }
}

export function usePublicSiteContact() {
    const query = useQuery({
        queryKey: [...PUBLIC_SITE_CONTACT_QUERY_KEY],
        queryFn: fetchPublicSiteContact,
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        placeholderData: DEFAULT_PUBLIC_SITE_CONTACT,
    });

    return {
        contact: query.data ?? DEFAULT_PUBLIC_SITE_CONTACT,
        isLoading: query.isLoading,
        isError: query.isError,
    };
}

export function useInvalidatePublicSiteContact() {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: [...PUBLIC_SITE_CONTACT_QUERY_KEY] });
}
