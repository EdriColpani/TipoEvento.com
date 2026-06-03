import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { fetchEventsVisibleToGestor } from '@/utils/manager-events-scope';
import { getEventCarouselBannerStatus, type EventCarouselBannerStatus } from '@/utils/event-carousel-banner-rules';

export interface ManagerEventCarouselBanner {
    id: string;
    event_id: string;
    image_url: string;
    headline: string;
    subheadline: string;
    display_order: number;
    start_date: string;
    end_date: string;
    created_at: string;
    event_title: string;
    status: EventCarouselBannerStatus;
}

export const MANAGER_EVENT_BANNERS_QUERY_KEY = 'managerEventBanners';

export async function fetchManagerEventCarouselBanners(
    userId: string,
    isAdminMaster: boolean,
    client: SupabaseClient = supabase,
): Promise<ManagerEventCarouselBanner[]> {
    if (!userId) return [];

    const events = await fetchEventsVisibleToGestor(client, userId, isAdminMaster);
    const eventIds = events.map((e) => e.id);
    const titleByEventId = Object.fromEntries(events.map((e) => [e.id, e.title]));

    let query = client
        .from('event_carousel_banners')
        .select('id, event_id, image_url, headline, subheadline, display_order, start_date, end_date, created_at')
        .order('display_order', { ascending: true })
        .order('start_date', { ascending: false });

    if (!isAdminMaster) {
        if (eventIds.length === 0) return [];
        query = query.in('event_id', eventIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((row) => ({
        id: row.id as string,
        event_id: row.event_id as string,
        image_url: row.image_url as string,
        headline: (row.headline as string) || '',
        subheadline: (row.subheadline as string) || '',
        display_order: Number(row.display_order) || 0,
        start_date: row.start_date as string,
        end_date: row.end_date as string,
        created_at: row.created_at as string,
        event_title: titleByEventId[row.event_id as string] || 'Evento',
        status: getEventCarouselBannerStatus(row.start_date as string, row.end_date as string),
    }));
}

export function useManagerEventBanners(userId: string | undefined, isAdminMaster: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: [MANAGER_EVENT_BANNERS_QUERY_KEY, userId, isAdminMaster],
        queryFn: () => fetchManagerEventCarouselBanners(userId!, isAdminMaster),
        enabled: Boolean(userId),
        staleTime: 60_000,
    });

    return {
        ...query,
        banners: query.data ?? [],
        invalidateBanners: () =>
            queryClient.invalidateQueries({ queryKey: [MANAGER_EVENT_BANNERS_QUERY_KEY] }),
    };
}
