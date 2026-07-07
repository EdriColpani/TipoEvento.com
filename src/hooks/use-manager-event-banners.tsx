import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchEventsVisibleToGestorRest } from '@/utils/manager-events-scope';
import { getEventCarouselBannerStatus, type EventCarouselBannerStatus } from '@/utils/event-carousel-banner-rules';
import { restGet } from '@/utils/supabase-rest';

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

type EventCarouselBannerRow = {
    id: string;
    event_id: string;
    image_url: string;
    headline: string | null;
    subheadline: string | null;
    display_order: number | null;
    start_date: string;
    end_date: string;
    created_at: string;
};

export async function fetchManagerEventCarouselBanners(
    userId: string,
    isAdminMaster: boolean,
): Promise<ManagerEventCarouselBanner[]> {
    if (!userId) return [];

    const events = await fetchEventsVisibleToGestorRest(userId, isAdminMaster);
    const eventIds = events.map((e) => e.id);
    const titleByEventId = Object.fromEntries(events.map((e) => [e.id, e.title]));

    const select =
        'id,event_id,image_url,headline,subheadline,display_order,start_date,end_date,created_at';

    let path = `event_carousel_banners?select=${select}&order=display_order.asc,start_date.desc`;

    if (!isAdminMaster) {
        if (eventIds.length === 0) return [];
        path += `&event_id=in.(${eventIds.join(',')})`;
    }

    const data = await restGet<EventCarouselBannerRow[]>(path, 10_000);

    return (data ?? []).map((row) => ({
        id: row.id,
        event_id: row.event_id,
        image_url: row.image_url,
        headline: row.headline || '',
        subheadline: row.subheadline || '',
        display_order: Number(row.display_order) || 0,
        start_date: row.start_date,
        end_date: row.end_date,
        created_at: row.created_at,
        event_title: titleByEventId[row.event_id] || 'Evento',
        status: getEventCarouselBannerStatus(row.start_date, row.end_date),
    }));
}

export function useManagerEventBanners(userId: string | undefined, isAdminMaster: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: [MANAGER_EVENT_BANNERS_QUERY_KEY, userId, isAdminMaster],
        queryFn: () => fetchManagerEventCarouselBanners(userId!, isAdminMaster),
        enabled: Boolean(userId),
        staleTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
    });

    return {
        ...query,
        banners: query.data ?? [],
        invalidateBanners: () =>
            queryClient.invalidateQueries({ queryKey: [MANAGER_EVENT_BANNERS_QUERY_KEY] }),
    };
}
