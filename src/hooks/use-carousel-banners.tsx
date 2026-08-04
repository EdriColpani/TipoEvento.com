import { useQuery } from '@tanstack/react-query';
import { restGetAuthOrPublic } from '@/utils/supabase-rest';
import { useCarouselSettings, type CarouselSettings } from './use-carousel-settings';
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
    events?: { date: string | null } | { date: string | null }[] | null;
};

function todayIso(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

function eventDateFromRow(row: BannerRow): Date | undefined {
    const raw = row.events;
    const dateStr = Array.isArray(raw) ? raw[0]?.date : raw?.date;
    return dateStr ? parseEventLocalDay(dateStr) ?? undefined : undefined;
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
        event_date: type === 'event' ? eventDateFromRow(row) : undefined,
        is_regional: type === 'event',
    };
}

async function fetchBannerRows(path: string): Promise<BannerRow[]> {
    const rows = await restGetAuthOrPublic<BannerRow[]>(path, 12_000);
    return Array.isArray(rows) ? rows : [];
}

const fetchEventBanners = async (): Promise<CarouselBanner[]> => {
    const refDay = todayIso();
    const baseFilter =
        `&start_date=lte.${encodeURIComponent(refDay)}` +
        `&end_date=gte.${encodeURIComponent(refDay)}` +
        '&order=display_order.asc';

    try {
        let rows: BannerRow[] = [];
        try {
            rows = await fetchBannerRows(
                'event_carousel_banners?select=id,image_url,headline,subheadline,display_order,start_date,end_date,event_id,events(date)' +
                    baseFilter,
            );
        } catch (embedErr) {
            console.warn('event_carousel_banners embed failed, retrying without events:', embedErr);
            rows = await fetchBannerRows(
                'event_carousel_banners?select=id,image_url,headline,subheadline,display_order,start_date,end_date,event_id' +
                    baseFilter,
            );
        }

        return rows
            .map((row) => mapRowToCarouselBanner(row, 'event'))
            .filter((b): b is CarouselBanner => b !== null);
    } catch (e) {
        console.warn('event_carousel_banners failed', e);
        return [];
    }
};

const fetchPromotionalBanners = async (): Promise<CarouselBanner[]> => {
    const refDay = todayIso();
    try {
        const rows = await fetchBannerRows(
            'promotional_banners?select=id,image_url,headline,subheadline,display_order,start_date,end_date,link_url' +
                `&start_date=lte.${encodeURIComponent(refDay)}` +
                `&end_date=gte.${encodeURIComponent(refDay)}` +
                '&order=display_order.asc',
        );

        return rows
            .map((row) => mapRowToCarouselBanner(row, 'promotional'))
            .filter((b): b is CarouselBanner => b !== null);
    } catch (e) {
        console.warn('promotional_banners failed', e);
        // Fallback: busca sem filtro de data e filtra no cliente
        try {
            const rows = await fetchBannerRows(
                'promotional_banners?select=id,image_url,headline,subheadline,display_order,start_date,end_date,link_url&order=display_order.asc',
            );
            return rows
                .map((row) => mapRowToCarouselBanner(row, 'promotional'))
                .filter((b): b is CarouselBanner => b !== null);
        } catch (e2) {
            console.warn('promotional_banners fallback failed', e2);
            return [];
        }
    }
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

    const maxDisplay = Math.max(1, Number(settings.max_banners_display) || 5);

    // Reserva slots para eventos regionais só quando existem banners de evento.
    // Sem eventos ativos, o carrossel fica 100% com banners promocionais.
    const minEventSlots =
        eventBannersSorted.length === 0
            ? 0
            : Math.min(
                  Math.max(0, Number(settings.min_regional_banners) || 0),
                  eventBannersSorted.length,
                  maxDisplay,
              );
    const promoSlots = Math.max(0, maxDisplay - minEventSlots);

    const selected = [
        ...eventBannersSorted.slice(0, minEventSlots),
        ...promotionalSorted.slice(0, promoSlots),
    ];

    // Se ainda sobrar espaço (ex.: poucos eventos), completa com mais promocionais
    if (selected.length < maxDisplay) {
        const used = new Set(selected.map((b) => b.id));
        for (const promo of promotionalSorted) {
            if (selected.length >= maxDisplay) break;
            if (used.has(promo.id)) continue;
            selected.push(promo);
            used.add(promo.id);
        }
    }

    return selected.sort(compareBanners);
};

export const useCarouselBanners = () => {
    const { settings } = useCarouselSettings();

    const settingsKey = [
        settings.rotation_time_seconds,
        settings.max_banners_display,
        settings.min_regional_banners,
        settings.days_until_event_threshold,
        settings.fallback_strategy,
    ].join('|');

    const query = useQuery({
        queryKey: ['carouselBanners', settingsKey],
        queryFn: () => fetchAndProcessBanners(settings),
        staleTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
    });

    return {
        ...query,
        banners: query.data ?? [],
        isLoading: query.isPending,
    };
};
