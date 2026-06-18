import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
    DEFAULT_PUBLIC_SITE_CONTACT,
    parsePublicSiteContact,
    type PublicSiteContact,
} from '@/utils/public-site-contact';

export const PUBLIC_SITE_CONTACT_QUERY_KEY = ['publicSiteContact'] as const;

async function fetchPublicSiteContact(): Promise<PublicSiteContact> {
    try {
        const { data, error } = await supabase.rpc('get_public_contact_info');
        if (error) {
            if (error.message?.includes('function') || error.code === '42883') {
                return DEFAULT_PUBLIC_SITE_CONTACT;
            }
            console.warn('get_public_contact_info:', error.message);
            return DEFAULT_PUBLIC_SITE_CONTACT;
        }
        return parsePublicSiteContact(data);
    } catch (e) {
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
