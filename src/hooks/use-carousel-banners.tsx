import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCarouselSettings, CarouselSettings } from './use-carousel-settings';
import { isBefore, differenceInDays, format } from 'date-fns';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { isCarouselBannerDisplayActive } from '@/utils/event-carousel-banner-rules';

export interface CarouselBanner {
    id: string;
    title: string;
    subtitle: string;
    image: string;
    link: string | null;
    display_order: number;
    type: 'event' | 'promotional';
    start_date: string;
    end_date: string;
    event_date?: Date;
    is_regional?: boolean;
}

type BannerRow = {
    id: string;
    image_url: string | null;
    headline: string | null;
    subheadline: string | null;
    display_order: number | null;
    start_date: string;
    end_date: string;
    event_id?: string | null;
    link_url?: string | null;
    events?: { date: string | null } | null;
};

function todayIso(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

function mapRowToCarouselBanner(row: BannerRow, type: 'event' | 'promotional'): CarouselBanner | null {
    if (!isCarouselBannerDisplayActive(row.start_date, row.end_date)) {
        return null;
    }
    if (!row.image_url?.trim()) {
        return null;
    }

    return {
        id: row.id,
        title: row.headline || (type === 'event' ? 'Evento em Destaque' : 'Promoção'),
        subtitle: row.subheadline || '',
        image: row.image_url,
        link:
            type === 'event' && row.event_id
                ? `/events/${row.event_id}`
                : row.link_url || null,
        display_order: Number(row.display_order) || 0,
        type,
        start_date: row.start_date,
        end_date: row.end_date,
        event_date:
            type === 'event' && row.events?.date
                ? parseEventLocalDay(row.events.date) ?? undefined
                : undefined,
        is_regional: type === 'event',
    };
}

const fetchEventBanners = async (): Promise<CarouselBanner[]> => {
    const refDay = todayIso();
    const { data, error } = await supabase
        .from('event_carousel_banners')
        .select(`
            id,
            image_url,
            headline,
            subheadline,
            display_order,
            start_date,
            end_date,
            event_id,
            events (date)
        `)
        .lte('start_date', refDay)
        .gte('end_date', refDay)
        .order('display_order', { ascending: true });

    if (error) {
        console.error('Error fetching event banners:', error);
        throw new Error(error.message);
    }

    return (data as BannerRow[])
        .map((row) => mapRowToCarouselBanner(row, 'event'))
        .filter((b): b is CarouselBanner => b !== null);
};

const fetchPromotionalBanners = async (): Promise<CarouselBanner[]> => {
    const refDay = todayIso();
    const { data, error } = await supabase
        .from('promotional_banners')
        .select(`
            id,
            image_url,
            headline,
            subheadline,
            display_order,
            start_date,
            end_date,
            link_url
        `)
        .lte('start_date', refDay)
        .gte('end_date', refDay)
        .order('display_order', { ascending: true });

    if (error) {
        console.error('Error fetching promotional banners:', error);
        throw new Error(error.message);
    }

    return (data as BannerRow[])
        .map((row) => mapRowToCarouselBanner(row, 'promotional'))
        .filter((b): b is CarouselBanner => b !== null);
};

const fetchAndProcessBanners = async (settings: CarouselSettings): Promise<CarouselBanner[]> => {
    const [eventBanners, promotionalBanners] = await Promise.all([
        fetchEventBanners(),
        fetchPromotionalBanners(),
    ]);

    let combinedBanners: Array<CarouselBanner & { isUpcomingPriority?: boolean }> = [
        ...eventBanners,
        ...promotionalBanners,
    ];
    const today = new Date();

    combinedBanners = combinedBanners.map((banner) => {
        if (banner.type === 'event' && banner.event_date) {
            const daysUntil = differenceInDays(banner.event_date, today);
            const isUpcomingPriority =
                daysUntil >= 0 && daysUntil <= settings.days_until_event_threshold;
            return { ...banner, isUpcomingPriority };
        }
        return banner;
    });

    const compareBanners = (
        a: CarouselBanner & { isUpcomingPriority?: boolean },
        b: CarouselBanner & { isUpcomingPriority?: boolean },
    ) => {
        if (a.display_order !== b.display_order) {
            return a.display_order - b.display_order;
        }
        if (a.type === 'promotional' && b.type === 'event') return -1;
        if (a.type === 'event' && b.type === 'promotional') return 1;

        const aIsPriority = a.type === 'event' && a.isUpcomingPriority;
        const bIsPriority = b.type === 'event' && b.isUpcomingPriority;
        if (aIsPriority && !bIsPriority) return -1;
        if (!aIsPriority && bIsPriority) return 1;

        if (a.type === 'event' && b.type === 'event' && a.event_date && b.event_date) {
            return isBefore(a.event_date, b.event_date) ? -1 : 1;
        }
        return 0;
    };

    const eventBannersSorted = combinedBanners.filter((b) => b.type === 'event').sort(compareBanners);
    const promotionalSorted = combinedBanners
        .filter((b) => b.type === 'promotional')
        .sort(compareBanners);

    const maxDisplay = Math.max(1, settings.max_banners_display);
    const minEventSlots = Math.min(
        settings.min_regional_banners,
        eventBannersSorted.length,
        maxDisplay,
    );
    const promoSlots = Math.max(0, maxDisplay - minEventSlots);

    const selected = [
        ...eventBannersSorted.slice(0, minEventSlots),
        ...promotionalSorted.slice(0, promoSlots),
    ];

    return selected.sort(compareBanners);
};

export const useCarouselBanners = () => {
    const { settings, isLoading: isLoadingSettings } = useCarouselSettings();

    const query = useQuery({
        queryKey: ['carouselBanners', settings],
        queryFn: () => fetchAndProcessBanners(settings),
        enabled: !isLoadingSettings,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
    });

    return {
        ...query,
        banners: query.data || [],
        isLoading: isLoadingSettings || query.isLoading,
    };
};
