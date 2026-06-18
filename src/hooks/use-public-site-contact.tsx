import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
    DEFAULT_PUBLIC_SITE_CONTACT,
    parsePublicSiteContact,
    type PublicSiteContact,
} from '@/utils/public-site-contact';

export const PUBLIC_SITE_CONTACT_QUERY_KEY = ['publicSiteContact'] as const;

async function fetchPublicSiteContact(): Promise<PublicSiteContact> {
    const { data, error } = await supabase.rpc('get_public_contact_info');
    if (error) {
        if (error.message?.includes('function') || error.code === '42883') {
            return DEFAULT_PUBLIC_SITE_CONTACT;
        }
        throw new Error(error.message);
    }
    return parsePublicSiteContact(data);
}

export function usePublicSiteContact() {
    const query = useQuery({
        queryKey: [...PUBLIC_SITE_CONTACT_QUERY_KEY],
        queryFn: fetchPublicSiteContact,
        staleTime: 60_000,
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
