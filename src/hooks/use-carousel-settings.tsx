import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CarouselSettings {
    rotation_time_seconds: number;
    max_banners_display: number;
    regional_distance_km: number;
    min_regional_banners: number;
    fallback_strategy: 'latest_events' | 'highest_rated' | 'random';
    days_until_event_threshold: number;
}

const DEFAULT_SETTINGS: CarouselSettings = {
    rotation_time_seconds: 5,
    max_banners_display: 5,
    regional_distance_km: 100,
    min_regional_banners: 3,
    fallback_strategy: 'latest_events',
    days_until_event_threshold: 30,
};

const fetchCarouselSettings = async (): Promise<CarouselSettings> => {
    try {
        const { data, error } = await supabase
            .from('carousel_settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        if (error) {
            console.warn('carousel_settings:', error.message);
            return DEFAULT_SETTINGS;
        }

        if (data) {
            return {
                rotation_time_seconds: data.rotation_time_seconds || DEFAULT_SETTINGS.rotation_time_seconds,
                max_banners_display: data.max_banners_display || DEFAULT_SETTINGS.max_banners_display,
                regional_distance_km: data.regional_distance_km || DEFAULT_SETTINGS.regional_distance_km,
                min_regional_banners: data.min_regional_banners || DEFAULT_SETTINGS.min_regional_banners,
                fallback_strategy: data.fallback_strategy || DEFAULT_SETTINGS.fallback_strategy,
                days_until_event_threshold:
                    data.days_until_event_threshold || DEFAULT_SETTINGS.days_until_event_threshold,
            } as CarouselSettings;
        }

        return DEFAULT_SETTINGS;
    } catch (e) {
        console.warn('carousel_settings failed', e);
        return DEFAULT_SETTINGS;
    }
};

export const useCarouselSettings = () => {
    const query = useQuery({
        queryKey: ['carouselSettings'],
        queryFn: fetchCarouselSettings,
        staleTime: 1000 * 60 * 10,
        retry: 1,
        refetchOnWindowFocus: false,
        placeholderData: DEFAULT_SETTINGS,
    });

    return {
        ...query,
        settings: query.data ?? DEFAULT_SETTINGS,
    };
};